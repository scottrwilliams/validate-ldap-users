# validate-ldap-users
Report on users with GitHub accounts within an organization that may no longer be with the company

## Quick start

1. Clone: `git clone` this repo
2. Install: `npm install -g` OR `npm install && npm link`
3. Replace command line arguments and run:
```
validate-ldap-users \
--ldapUrl=ldap://company.com \
--ldapUser=user \
--ldapPassword=pass \
--ldapBaseSearch=OU=Users,DC=domain,DC=local \
--githubOrgs=org1,org2 \
--githubToken=token
```

## Argument details
* [How to get a GitHub personal access token](https://help.github.com/articles/creating-a-personal-access-token-for-the-command-line/)
