/* vim: set ts=8 sts=8 sw=8 noet: */

'use strict';

var mod_assert = require('assert-plus');
var mod_fs = require('fs');
var mod_path = require('path');
var mod_verror = require('verror');

var VE = mod_verror.VError;

var DIR;
var ISSUES;
var ISSUES_LIST;


function
read_file(type, key)
{
	var path = mod_path.join(DIR, type, key + '.json');

	try {
		return (JSON.parse(mod_fs.readFileSync(path).toString('utf8')));
	} catch (ex) {
		if (ex.code === 'ENOENT') {
			return (null);
		}

		throw (new VE(ex, 'could not parse "%s"', path));
	}
}

function
list_files(type)
{
	var path = mod_path.join(DIR, type);
	var ents = mod_fs.readdirSync(path);

	var out = [];

	for (var i = 0; i < ents.length; i++) {
		var m = ents[i].match(/^(.+).json$/);

		if (m === null) {
			continue;
		}

		out.push(m[1]);
	}

	return (out.sort());
}


function
files_issue_list(labels, offset, sort, done)
{
	mod_assert.arrayOfString(labels, 'labels');
	mod_assert.number(offset, 'offset');
	mod_assert.string(sort, 'sort');
	mod_assert.ok(!isNaN(offset) && offset >= 0, 'offset >= 0');
	mod_assert.func(done, 'done');

	if (sort !== 'key') {
		done(new VE('invalid sort "%s"', sort));
		return;
	}

	var maxResults = 50;

	var keys = ISSUES_LIST.filter(function (key) {
		var issue = ISSUES[key];

		for (var i = 0; i < labels.length; i++) {
			if (issue.fields.labels.indexOf(labels[i]) === -1) {
				return (false);
			}
		}

		return (true);
	});

	var res = {
		total: keys.length,
		issues: keys.slice(offset, offset + maxResults).map(
		    function (key) {
			return (ISSUES[key]);
		})
	};

	setImmediate(done, null, res);
}

function
files_issue_get(key, done)
{
	mod_assert.string(key, 'key');
	mod_assert.func(done, 'done');

	if (!key.match(/-/)) {
		setImmediate(done, new VE('issue key "%s" not valid', key));
		return;
	}

	var id = ISSUES[key].id;
	var issue;
	if (!id || (issue = read_file('issue', id)) === null) {
		setImmediate(done, new VE({ info: { notfound: true }},
		    'get issue "%s": not found'));
		return;
	}

	if (!issue || !issue.fields || !issue.fields.labels) {
		setImmediate(done, new VE(
		    'issue "%s" did not have expected format', key));
		return;
	}

	setImmediate(done, null, issue);
}

function
files_remotelink_get(id, done)
{
	mod_assert.string(id, 'id');
	mod_assert.func(done, 'done');

	var rlink = read_file('remotelink', id);
	if (rlink === null) {
		/*
		 * If there is no remote link list for this issue, just return
		 * an empty list.
		 */
		setImmediate(done, null, []);
		return;
	}

	if (!Array.isArray(rlink)) {
		setImmediate(done, new VE(
		    'issue "%s" remotelink did not have expected format', id));
		return;
	}

	setImmediate(done, null, rlink);
}

function
files_backend_init(_config, log)
{
	mod_assert.string(process.env.LOCAL_STORE, 'LOCAL_STORE');
	DIR = process.env.LOCAL_STORE;

	log.info('loading issue cache from "%s"', DIR);

	ISSUES = {};
	var ids = list_files('issue');
	for (var i = 0; i < ids.length; i++) {
		var io = read_file('issue', ids[i]);

		/*
		 * Mock up an object like the one returned from the JIRA search
		 * we use to construct the issue list.  Needs to match with
		 * what jira_issue_list() returns.
		 */
		ISSUES[io.key] = {
			key: io.key,
			id: ids[i],
			fields: {
				labels: io.fields.labels,
				summary: io.fields.summary,
				resolution: io.fields.resolution
			}
		};
	}
	ISSUES_LIST = Object.keys(ISSUES).sort(function (a, b) {
		var ma = a.split('-');
		var mb = b.split('-');

		if (ma[0] < mb[0]) {
			return (-1);
		} else if (ma[0] > mb[0]) {
			return (1);
		}

		if (+ma[1] < +mb[1]) {
			return (-1);
		} else if (+ma[1] > +mb[1]) {
			return (1);
		}

		return (0);
	}).reverse();

	log.info('loading issue cache from "%s" complete: %d issues', DIR,
	    Object.keys(ISSUES).length);

	return ({
		be_name: 'files',
		be_issue_list: files_issue_list,
		be_issue_get: files_issue_get,
		be_remotelink_get: files_remotelink_get
	});
}

module.exports = {
	files_backend_init: files_backend_init
};
