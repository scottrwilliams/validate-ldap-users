'use strict';

const ldap = require('ldapjs'),
  GitHubApi = require('@octokit/rest');

function sanatizeName(name) {
  let cleanName = name.trim().toLowerCase();
  const splitName = cleanName.split(' ');
  //remove middle name
  if (splitName.length > 2) {
    cleanName = splitName[0] + ' ' + splitName[splitName.length - 1];
  }
  return cleanName;
}

function searchLDAP(ldapUser, ldapPassword, url, ldapBaseSearch) {
  return new Promise(resolve => {
    const client = ldap.createClient({
      url
    });

    const opts = {
      filter: '(&(objectclass=person)(company=*))',
      scope: 'sub',
      attributes: ['sAMAccountName', 'name', 'givenName', 'sn', 'distinguishedName']
    };

    client.bind(ldapUser, ldapPassword, () => {
      const ldapUserLookup = new Set();
      const ldapUserNameLookup = new Set();
      let numLdapUsers = 0;
      client.search(
        ldapBaseSearch,
        opts,
        (error, search) => {
          search.on('searchEntry', entry => {
            const ldapEntry = entry.object;
            if (!/restricted|_hold|test/.test(ldapEntry.distinguishedName.toLowerCase())) {
              ldapUserLookup.add(sanatizeName(ldapEntry.name));
              ldapUserNameLookup.add(ldapEntry.sAMAccountName.toLowerCase());
              numLdapUsers++;
            }
          });
          search.on('end', () => {
            client.unbind();
            resolve({
              ldapUserLookup,
              ldapUserNameLookup,
              numLdapUsers
            });
          });
        }
      );
    });
  });
}

async function fetchGitHubUsers(token, org) {
  const github = new GitHubApi({
    auth: token
  });

  let members = await github.paginate(
    github.orgs.listMembers.endpoint.merge({
      org
    })
  );
  //chunk fetching details to avoid https://developer.github.com/v3/#abuse-rate-limits
  let gitHubUsers = [];
  while (members.length) {
    const chunks = await Promise.all(
      members.splice(0, 50).map(member => github.users.getByUsername({
        username: member.login
      })));
    gitHubUsers = gitHubUsers.concat(chunks.map(user => user.data));
  }
  return gitHubUsers;
}

module.exports.validate = async (ldapUser, ldapPassword, ldapUrl, ldapBaseSearch,
  githubToken, githubOrgs) => {
  const results = await searchLDAP(ldapUser, ldapPassword, ldapUrl, ldapBaseSearch);
  console.log(`\nFound ${results.numLdapUsers} users in LDAP`);

  for (const githubOrg of githubOrgs.split(',')) {
    const githubUsers = await fetchGitHubUsers(githubToken, githubOrg);

    console.log(`\n----- GitHub Users: ${githubOrg} -----`);
    let numNotFoundGithub = 0;
    for (const {
        name,
        login
      } of githubUsers) {
      if (!name) {
        console.log(`No GitHub name defined for ${login}`);
        numNotFoundGithub++;
      } else if (!results.ldapUserLookup.has(sanatizeName(name))) {
        const names = name.split(' ');
        const username = names.length === 2 ? (names[0][0] + names[1]).toLowerCase() : '';
        let warning = `Cannot find ${login} (${name})`;
        if (!results.ldapUserNameLookup.has(username)) {
          warning += ' **********';
        }
        console.log(warning);
        numNotFoundGithub++;
      }
    }
    console.log(`Could not find ${numNotFoundGithub} of ${githubUsers.length} Github users`);
  }
}
