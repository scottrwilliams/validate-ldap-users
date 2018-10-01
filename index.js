'use strict';

const ldap = require('ldapjs'),
  rc = require('rc'),
  GitHubApi = require('@octokit/rest'),
  Slack = require('slack-node');

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

function fetchGitHubUsers(githubToken, org) {
  if (githubToken === undefined) {
    return;
  }

  const github = new GitHubApi();
  github.authenticate({
    type: 'oauth',
    token: githubToken
  });

  return new Promise(resolve => {
      let members = [];
      const requestMembers = (err, res) => {
        members = members.concat(res.data);
        if (github.hasNextPage(res)) {
          github.getNextPage(res, requestMembers);
        } else {
          resolve(members);
        }
      };
      github.orgs.getMembers({
        org,
        per_page: 100
      }, requestMembers);
    })
    .then(members =>
      //throttle GitHub calls sequentially
      members.reduce((promise, member) => promise.then(result =>
        new Promise(resolve => {
          github.users.getForUser({
            username: member.login
          }, (err, res) => {
            resolve(res);
          });
        }).then(Array.prototype.concat.bind(result))), Promise.resolve([]))
      /*
      Promise.all(members.map(member =>
          new Promise(resolve => {
              github.users.getForUser({username: member.login}, (err, res) => { resolve(res); });
          })
      ))
      */
    );
}

function fetchSlackUsers(slackToken) {
  if (slackToken === undefined) {
    return;
  }

  const slack = new Slack(slackToken);
  return new Promise(resolve => {
    slack.api('users.list', (err, res) => {
      resolve(res.members.filter(member => !member.deleted));
    });
  });
}

const conf = rc('thirdPartyChecker');
Promise.all([
    searchLDAP(conf.ldapUser, conf.ldapPassword, conf.ldapUrl, conf.ldapBaseSearch, conf.email),
    fetchGitHubUsers(conf.githubToken, conf.githubOrg),
    fetchSlackUsers(conf.slackToken)
  ])
  .then(([results, githubUsers, slackUsers]) => {
    console.log(`Found ${results.numLdapUsers} users in LDAP`);
    if (githubUsers) {
      console.log('----- GitHub Users -----');
      let numNotFoundGithub = 0;
      for (const user of githubUsers) {
        if (!user.data.name) {
          console.log(`No GitHub name defined for ${user.data.login}`);
          numNotFoundGithub++;
        } else if (!results.ldapUserLookup.has(sanatizeName(user.data.name))) {
          const names = user.data.name.split(' ');
          const username = names.length === 2 ? (names[0][0] + names[1]).toLowerCase() : '';
          let warning = `Cannot find ${user.data.login} (${user.data.name})`;
          if (!results.ldapUserLookup.has(username)) {
            warning += ' **********';
          }
          console.log(warning);
          numNotFoundGithub++;
        }
      }
      console.log(`Could not find ${numNotFoundGithub} of ${githubUsers.length} Github users`);
    }

    if (slackUsers) {
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
  })
  .catch(reason => {
    console.error(reason);
  });
