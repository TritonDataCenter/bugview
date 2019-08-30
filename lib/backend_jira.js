/* vim: set ts=8 sts=8 sw=8 noet: */

'use strict';

var mod_assert = require('assert-plus');
var mod_restify = require('restify');
var mod_verror = require('verror');
var mod_querystring = require('querystring');

var VE = mod_verror.VError;

var JIRA;
var CONFIG;


function
jira_issue_list(labels, offset, sort, done)
{
	mod_assert.arrayOfString(labels, 'labels');
	mod_assert.number(offset, 'offset');
	mod_assert.ok(!isNaN(offset) && offset >= 0, 'offset >= 0');
	mod_assert.string(sort, 'sort');
	mod_assert.func(done, 'done');

	var maxResults = 50;

	var jql = labels.map(function (label) {
		return ('labels = "' + label + '"');
	}).join(' AND ');

	var qopts = {
		maxResults: maxResults,
		startAt: offset,
		fields: [ 'summary', 'resolution', 'updated',
		    'created' ].join(','),
		jql: jql
	};

	if (sort === 'created' || sort === 'updated') {
		qopts.jql += ' ORDER BY ' + sort + ' DESC';
	} else if (sort !== 'key') {
		done(new VE('invalid sort "%s"'), sort);
		return;
	}

	var url = CONFIG.url.path + '/search?' +
	    mod_querystring.stringify(qopts);

	JIRA.get(url, function (err, req, res, results) {
		if (err) {
			done(new VE(err, 'communicating with JIRA'));
			return;
		}

		if (!Array.isArray(results.issues)) {
			done(new VE('"issues" not an array in response'));
			return;
		}

		done(null, {
			total: Number(results.total) || 10000000,
			issues: results.issues
		});
	});
}

function
jira_issue_get(key, done)
{
	mod_assert.string(key, 'key');
	mod_assert.func(done, 'done');

	if (!key.match(/-/)) {
		setImmediate(done, new VE('issue key "%s" not valid', key));
		return;
	}

	var url = CONFIG.url.path + '/issue/' + key;

	JIRA.get(url, function (err, req, res, issue) {
		if (err) {
			var info = {};

			if (err.name === 'NotFoundError') {
				info.notfound = true;
			}

			done(new VE({ cause: err, info: info },
			    'get issue "%s"', key));
			return;
		}

		if (!issue || !issue.fields || !issue.fields.labels) {
			done(new VE('issue "%s" did not have expected format',
			    key));
			return;
		}

		done(null, issue);
	});
}

function
jira_remotelink_get(id, done)
{
	mod_assert.string(id, 'id');
	mod_assert.func(done, 'done');

	if (id.match(/-/)) {
		setImmediate(done, new VE('issue ID "%s" not valid', id));
		return;
	}

	var url = CONFIG.url.path + '/issue/' + id + '/remotelink';

	JIRA.get(url, function (err, req, res, links) {
		if (err) {
			done(new VE(err, 'get issue links "%s"', id));
			return;
		}

		mod_assert.array(links, 'links');

		done(null, links);
	});
}

function
jira_backend_init(config, log)
{
	CONFIG = config;

	JIRA = mod_restify.createJsonClient({
		url: config.url.base,
		connectTimeout: 15000,
		userAgent: 'JoyentJIRAPublicAccess',
		log: log.child({
			component: 'jira'
		})
	});
	JIRA.basicAuth(CONFIG.username, CONFIG.password);

	return ({
		be_name: 'jira',
		be_issue_list: jira_issue_list,
		be_issue_get: jira_issue_get,
		be_remotelink_get: jira_remotelink_get
	});
}

module.exports = {
	jira_backend_init: jira_backend_init
};
