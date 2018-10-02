# validate-ldap-users
Flag users from Slack & GitHub that may no longer be with a company

## Usage
```
npm run start -- \
--ldapUrl=ldap://company.com \
--ldapUser=user \
--ldapPassword=pass \
--ldapBaseSearch=OU=Users,DC=domain,DC=local \
--email=company.com \
--githubOrg=company \
--githubToken=token \
--slackToken=token
```
