'use strict';

const ldap = require('ldapjs'),
  rc = require('rc'),
  GitHubApi = require('@octokit/rest'),
  Slack = require('@slack/client');

function sanatizeEmail(name) {
  return name
    .substring(0, name.lastIndexOf('@'))
    .replace(/[^\w.-]+/g, '')
    .toLowerCase();
}

function sanatizeName(name) {
  let cleanName = name.trim().toLowerCase();
  const splitName = cleanName.split(' ');
  //remove middle name
  if (splitName.length > 2) {
    cleanName = splitName[0] + ' ' + splitName[splitName.length - 1];
  }
  return cleanName;
}

function searchLDAP(ldapUser, ldapPassword, url, ldapBaseSearch, email) {
  return new Promise(resolve => {
    const client = ldap.createClient({
      url
    });

    const opts = {
      filter: '(&(objectclass=person)(company=*))',
      scope: 'sub',
      attributes: ['sAMAccountName', 'mail', 'name', 'givenName', 'sn', 'distinguishedName']
    };

    client.bind(ldapUser, ldapPassword, () => {
      const ldapUserLookup = new Set();
      let numLdapUsers = 0;
      client.search(
        ldapBaseSearch,
        opts,
        (error, search) => {
          search.on('searchEntry', entry => {
            const ldapEntry = entry.object;
            if (ldapEntry.distinguishedName.toLowerCase().indexOf('restricted') === -1 &&
              ldapEntry.distinguishedName.toLowerCase().indexOf('_hold') === -1 &&
              ldapEntry.distinguishedName.toLowerCase().indexOf('test') === -1) {
              ldapUserLookup.add(sanatizeName(ldapEntry.name));
              ldapUserLookup.add(ldapEntry.sAMAccountName.toLowerCase());
              if (ldapEntry.mail) {
                ldapUserLookup.add(sanatizeEmail(ldapEntry.mail));
              }
              const emailFromName = `${ldapEntry.givenName}.${ldapEntry.sn}@${email}`;
              ldapUserLookup.add(sanatizeEmail(emailFromName));
              numLdapUsers++;
            }
          });
          search.on('end', () => {
            client.unbind();
            resolve({
              ldapUserLookup,
              numLdapUsers
            });
          });
        }
      );
    });
  });
}

async function fetchGitHubUsers(token, org) {
  const github = new GitHubApi();
  github.authenticate({
    type: 'oauth',
    token: token
  });

  let response = await github.orgs.getMembers({
    org,
    per_page: 100
  });
  let members = response.data;
  while (github.hasNextPage(response)) {
    response = await github.getNextPage(response);
    members = members.concat(response.data);
  }

  //chunk fetching details to avoid https://developer.github.com/v3/#abuse-rate-limits
  let gitHubUsers = [];
  while (members.length) {

    const chunks = await Promise.all(
      members.splice(0, 50).map(member => github.users.getForUser({
        username: member.login
      })));
    gitHubUsers = gitHubUsers.concat(chunks.map(user => user.data));
  }
  return gitHubUsers;
}

async function fetchSlackUsers(slackToken) {
  const slack = new Slack.WebClient(slackToken);
  const list = await slack.users.list();
  return list.members.filter(member => !member.deleted);
}

(async () => {
  const conf = rc('thirdPartyChecker');
  const results = await searchLDAP(conf.ldapUser, conf.ldapPassword, conf.ldapUrl, conf.ldapBaseSearch, conf.email);
  console.log(`Found ${results.numLdapUsers} users in LDAP`);

  if (conf.githubToken && conf.githubOrg) {
    const githubUsers = await fetchGitHubUsers(conf.githubToken, conf.githubOrg);
    console.log('----- GitHub Users -----');
    let numNotFoundGithub = 0;
    for (const user of githubUsers) {
      if (!user.name) {
        console.log(`No GitHub name defined for ${user.login}`);
        numNotFoundGithub++;
      } else if (!results.ldapUserLookup.has(sanatizeName(user.name))) {
        const names = user.name.split(' ');
        const username = names.length === 2 ? (names[0][0] + names[1]).toLowerCase() : '';
        let warning = `Cannot find ${user.login} (${user.name})`;
        if (!results.ldapUserLookup.has(username)) {
          warning += ' **********';
        }
        console.log(warning);
        numNotFoundGithub++;
      }
    }
    console.log(`Could not find ${numNotFoundGithub} of ${githubUsers.length} Github users`);
  }

  if (conf.slackToken) {
    const slackUsers = await fetchSlackUsers(conf.slackToken);
    console.log('----- Slack Users -----');
    let numNotFoundSlack = 0;
    let bots = [];
    for (const user of slackUsers) {
      const email = user.profile.email;
      if (user.is_bot) {
        bots.push(user.name);
      } else if (!email) {
        console.log(`${user.name} does not have an email address`);
        numNotFoundSlack++;
      } else {
        const emailName = sanatizeEmail(email);
        if (!results.ldapUserLookup.has(emailName)) {
          if (user.profile.guest_channels) {
            console.log(`Could not find GUEST ${user.name} (${email})`);
          } else {
            console.log(`Could not find ${user.name} (${email})`);
          }
          numNotFoundSlack++;
        }
      }
    }
    console.log(`Could not find ${numNotFoundSlack} of ${slackUsers.length} Slack users`);
    console.log('Bots: ' + bots)
  }
})();
