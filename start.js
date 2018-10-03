#!/usr/bin/env node

'use strict';

const rc = require('rc'),
  validateLdapUsers = require('./validate');

const conf = rc('validate-ldap-users');
const {
  ldapUser,
  ldapPassword,
  ldapUrl,
  ldapBaseSearch,
  email,
  githubToken,
  githubOrg,
  slackToken
} = conf;

validateLdapUsers.validate(ldapUser, ldapPassword, ldapUrl, ldapBaseSearch, email,
  githubToken, githubOrg, slackToken);
