# validate-ldap-users
Report on users with Slack or GitHub accounts within an organization that may no longer be with the company

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
--email=company.com \
--githubOrg=company \
--githubToken=token \
--slackToken=token
```

###Argument details###
* [How to get a GitHub personal access token](https://help.github.com/articles/creating-a-personal-access-token-for-the-command-line/)
* [How to get a Slack API token](https://get.slack.help/hc/en-us/articles/215770388-Create-and-regenerate-API-tokens)
