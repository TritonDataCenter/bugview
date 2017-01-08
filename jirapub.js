#!/usr/bin/env node
/* vim: set ts=8 sts=8 sw=8 noet: */

var mod_assert = require('assert-plus');
var mod_restify = require('restify');
var mod_bunyan = require('bunyan');
var mod_fs = require('fs');
var mod_path = require('path');
var mod_ent = require('ent');
var mod_human = require('human-time');
var mod_url = require('url');

var LOG = mod_bunyan.createLogger({
	name: 'jirapub',
	level: process.env.LOG_LEVEL || mod_bunyan.INFO
});

var HEADING_LEVELS = [ 1, 2, 3, 4, 5, 6 ].map(function (l) {
	return ('' + l);
});

var TEMPLATES = {};

var CONFIG = read_config(LOG);

var JIRA;
var SERVER;

/*
 * Initialisation Routines:
 */

function
read_templates(log)
{
	var tdir = mod_path.join(__dirname, 'templates');
	var ents = mod_fs.readdirSync(tdir);

	for (var i = 0; i < ents.length; i++) {
		var path = mod_path.join(tdir, ents[i]);
		var nam = ents[i].replace(/\.[^.]*$/, '');

		log.info({
			template_name: nam,
			path: path
		}, 'load template');
		TEMPLATES[nam] = mod_fs.readFileSync(path, 'utf8');
	}
}

function
read_config(log)
{
	var p = mod_path.join(__dirname, 'config.json');
	var f = mod_fs.readFileSync(p, 'utf8');
	var c = JSON.parse(f);

	try {
		var CHECK = [ 'username', 'password', 'url', 'label', 'port',
		    'http_proto' ];
		for (var i = 0; i < CHECK.length; i++) {
			mod_assert.ok(c[CHECK[i]], 'config.' + CHECK[i]);
		}
		mod_assert.string(c.url.base, 'config.url.base');
		mod_assert.string(c.url.path, 'config.url.path');
	} catch (ex) {
		log.error(ex, 'configuration validation failed');
		process.exit(1);
	}

	return (c);
}

function
create_http_server(log, callback)
{
	var s = mod_restify.createServer({
		name: 'jirapub',
		log: log.child({
			component: 'http'
		})
	});

	s.use(mod_restify.queryParser({
		mapParams: false
	}));

	s.get(/^\/bugview\/*$/, function (req, res, next) {
		var base = req.url.replace(/\/*$/, '');

		res.header('Location', base + '/index.html');
		res.send(302);
		next(false);
	});
	s.get('/bugview/index.html', handle_issue_index);
	s.get('/bugview/json/:key', handle_issue_json);
	s.get('/bugview/:key', handle_issue);

	s.on('uncaughtException', function (req, res, route, err) {
		req.log.error(err, 'uncaught exception!');
	});

	s.listen(CONFIG.port, function (err) {
		if (err) {
			log.error(err, 'http listen error');
			process.exit(1);
		}

		log.info({
			port: CONFIG.port
		}, 'http listening');

		callback(s);
	});
}

/*
 * Route Handlers:
 */

function
template(nam)
{
	mod_assert.string(nam, 'nam');
	mod_assert.string(TEMPLATES[nam], 'TEMPLATES["' + nam + '"]');

	return (TEMPLATES[nam]);
}

function
format_primary(title, content)
{
	mod_assert.string(title, 'title');
	mod_assert.string(content, 'content');

	var out = template('primary');

	out = out.replace(/%%CONTAINER%%/g, content);
	out = out.replace(/%%HTTP%%/g, CONFIG.http_proto);
	out = out.replace(/%%TITLE%%/g, title);

	return (out);
}


function
handle_issue_index(req, res, next)
{
	var log = req.log.child({
		remoteAddress: req.socket.remoteAddress,
		remotePort: req.socket.remotePort,
		userAgent: req.headers['user-agent'],
		referrer: req.headers['referrer'],
		forwardedFor: req.headers['x-forwarded-for'],
		issue_index: true
	});

	var offset;
	if (req.query && req.query.offset) {
		offset = parseInt(req.query.offset, 10);
	}
	if (!offset || isNaN(offset) || offset < 0 || offset > 10000000) {
		offset = 0;
	}
	offset = Math.floor(offset / 50) * 50;

	var url = CONFIG.url.path + '/search?jql=labels%20%3D%20%22' +
	    CONFIG.label + '%22&fields=summary,resolution&startAt=' +
	    offset;

	log.info({
		url: url,
		offset: offset
	}, 'fetch from JIRA');
	JIRA.get(url, function (_err, _req, _res, results) {
		if (_err) {
			log.error(_err, 'error communicating with JIRA');
			res.send(500);
			next(false);
			return;
		}

		var total = Number(results.total) || 10000000;

		if (offset > total) {
			var x = Math.max(total - 50, 0);
			log.info({
				offset: offset,
				total: total,
				redir_offset: x
			}, 'redirecting to last page');
			res.header('Location', 'index.html?offset=' + x);
			res.send(302);
			next(false);
			return;
		}

		log.info({
			offset: offset,
			total: total
		}, 'serving issue index');

		/*
		 * Construct Issue Index table:
		 */
		var container = template('issue_index');
		var tbody = '';
		for (var i = 0; i < results.issues.length; i++) {
			var issue = results.issues[i];
			var resolution = '&nbsp';

			if (issue.fields.resolution &&
			    issue.fields.resolution.name) {
				resolution = issue.fields.resolution.name;
			}

			tbody += [
				'<tr><td>',
				'<a href="' + issue.key + '">',
				issue.key,
				'</a>',
				'</td><td>',
				resolution,
				'</td><td>',
				issue.fields.summary,
				'</td></tr>',
			].join('') + '\n';
		}
		container = container.replace(/%%TABLE_BODY%%/g, tbody);

		/*
		 * Construct paginated navigation links:
		 */
		var pagin = [];
		pagin.push('<a href="index.html?offset=0">First Page</a>');
		if (offset > 0) {
			var prev = Math.max(offset - 50, 0);
			pagin.push('<a href="index.html?offset=' +
			    prev + '">Previous Page</a>');
		}
		if (total) {
			var count = Math.min(50, total - offset);
			pagin.push('Displaying from ' + offset + ' to ' +
			    (count + offset) + ' of ' + total);
		}
		if ((offset + 50) <= total) {
			pagin.push('<a href="index.html?offset=' +
			    (offset + 50) + '">Next Page</a>');
		}
		container = container.replace(/%%PAGINATION%%/g,
		    pagin.join(' | '));

		/*
		 * Construct page from primary template and our table:
		 */
		var out = format_primary('SmartOS Public Issues Index',
		    container);

		/*
		 * Deliver response to client:
		 */
		res.contentType = 'text/html';
		res.contentLength = out.length;

		res.writeHead(200);
		res.write(out);
		res.end();

		next();
		return;
	});
}

function
handle_issue_json(req, res, next)
{
	var log = req.log.child({
		remoteAddress: req.socket.remoteAddress,
		remotePort: req.socket.remotePort,
		userAgent: req.headers['user-agent'],
		referrer: req.headers['referrer'],
		forwardedFor: req.headers['x-forwarded-for'],
		issue: req.params.key
	});

	if (!req.params.key || !req.params.key.match(/^[A-Z]+-[0-9]+$/)) {
		log.error({ key: req.params.key }, 'invalid "key" provided');
		res.send(400);
		next(false);
		return;
	}

	var url = CONFIG.url.path + '/issue/' + req.params.key;

	JIRA.get(url, function (_err, _req, _res, issue) {
		if (_err) {
			if (_err && _err.name === 'NotFoundError') {
				log.error(_err, 'could not find issue');
				res.send(404);
				next(false);
				return;
			}
			log.error(_err, 'error communicating with JIRA');
			res.send(500);
			next(false);
			return;
		}

		if (!issue || !issue || !issue.fields || !issue.fields.labels) {
			log.error('JIRA issue did not have expected format');
			res.send(500);
			next(false);
			return;
		}

		if (issue.fields.labels.indexOf(CONFIG.label) === -1) {
			log.error('request for non-public issue');
			res.send(403);
			next(false);
			return;
		}

		log.info('serving issue');

		/*
		 * Construct our page from the primary template with the
		 * formatted issue in the container:
		 */
		var out = format_issue_json(issue);

		/*
		 * Deliver response to client:
		 */
		res.contentType = 'application/json';
		res.contentLength = out.length;

		res.writeHead(200);
		res.write(out);
		res.end();

		next();
		return;
	});

}

function
handle_issue(req, res, next)
{
	var log = req.log.child({
		remoteAddress: req.socket.remoteAddress,
		remotePort: req.socket.remotePort,
		userAgent: req.headers['user-agent'],
		referrer: req.headers['referrer'],
		forwardedFor: req.headers['x-forwarded-for'],
		issue: req.params.key
	});

	if (!req.params.key || !req.params.key.match(/^[A-Z]+-[0-9]+$/)) {
		log.error({ key: req.params.key }, 'invalid "key" provided');
		res.send(400);
		next(false);
		return;
	}

	var url = CONFIG.url.path + '/issue/' + req.params.key;

	JIRA.get(url, function (_err, _req, _res, issue) {
		if (_err) {
			if (_err && _err.name === 'NotFoundError') {
				log.error(_err, 'could not find issue');
				res.send(404,
				    'Sorry, that issue does not exist.\n');
				next(false);
				return;
			}
			log.error(_err, 'error communicating with JIRA');
			res.send(500);
			next(false);
			return;
		}

		if (!issue || !issue || !issue.fields || !issue.fields.labels) {
			log.error('JIRA issue did not have expected format');
			res.send(500);
			next(false);
			return;
		}

		if (issue.fields.labels.indexOf(CONFIG.label) === -1) {
			log.error('request for non-public issue');
			res.send(403, 'Sorry, this issue is not public.\n');
			next(false);
			return;
		}

		log.info('serving issue');

		/*
		 * Construct our page from the primary template with the
		 * formatted issue in the container:
		 */
		var out = format_primary(format_issue_title(issue),
		    format_issue(issue));

		/*
		 * Deliver response to client:
		 */
		res.contentType = 'text/html';
		res.contentLength = out.length;

		res.writeHead(200);
		res.write(out);
		res.end();

		next();
		return;
	});
}

/*
 * Formatter:
 */

/*
 * Access to issues is normally restricted to those with the correct label.
 * In the case of issue _links_, we do not have the labels for the
 * referenced issue.  If "link_whitelist" is specified in the
 * configuration, links to projects listed in that whitelist will be
 * rendered as a list.  If no whitelist is provided, or the linked issue
 * is not from a project in the whitelist, the link will not be displayed.
 */
function
allow_issue(key)
{
	var m = key.match(/^([A-Z]+)-([0-9]+)/);

	if (!CONFIG.link_whitelist) {
		return (false);
	}

	if (!m) {
		return (false);
	}

	if (CONFIG.link_whitelist.indexOf(m[1]) === -1) {
		return (false);
	}

	return (true);
}

function
fix_url(input)
{
	var out = input.trim();
	var url;

	var SUBS = {
		'mo.joyent.com': [
			{
				h: 'github.com',
				m: '/illumos-joyent',
				p: '/joyent/illumos-joyent'
			},
			{
				h: 'github.com',
				m: '/smartos-live',
				p: '/joyent/smartos-live'
			},
			{
				h: 'github.com',
				m: '/illumos-extra',
				p: '/joyent/illumos-extra'
			},
			{
				h: 'github.com',
				m: '/sdc-napi',
				p: '/joyent/sdc-napi'
			}
		]
	};

	try {
		url = mod_url.parse(out);
	} catch (ex) {
		LOG.error({
			err: ex,
			url: out
		}, 'url parse error');
		return (out);
	}

	if (!SUBS[url.hostname]) {
		return (mod_ent.encode(out));
	}

	for (var i = 0; i < SUBS[url.hostname].length; i++) {
		var s = SUBS[url.hostname][i];
		var re = new RegExp('^' + s.m);

		if (re.test(url.pathname)) {
			url.hostname = url.host = s.h;
			url.path = url.pathname =
			    url.pathname.replace(re, s.p);
			return (mod_ent.encode(mod_url.format(url)));
		}
	}

	return (mod_ent.encode(out));
}

/*
 * If this character appears before a formatting character, such as "*" or "_",
 * then the formatting character takes effect.  Used to allow formatting
 * characters to appear mid-word without being interpreted as a formatting
 * character.
 */
function
prefmtok(x)
{
	if (x === null) {
		return (true);
	}

	var cc_A = 'A'.charCodeAt(0);
	var cc_a = 'a'.charCodeAt(0);
	var cc_Z = 'Z'.charCodeAt(0);
	var cc_z = 'z'.charCodeAt(0);

	var cc = x.charCodeAt(0);

	if ((cc >= cc_A && cc <= cc_Z) ||
	    (cc >= cc_a && cc <= cc_z)) {
		return (false);
	}

	return (true);
}

function
repeat_char(c, n)
{
	var out = '';

	while (out.length < n)
		out += c;

	return (out);
}

/*
 * Make some attempt to parse JIRA markup.  This is neither rigorous, nor
 * even particularly compliant, but it improves the situation somewhat.
 */
function
parse_jira_markup(desc, ps)
{
	var text = '';
	var formats = [];
	var out = [];
	var state = 'LEADING_SPACES';
	var link_title = '';
	var link_url = '';
	var leading_spaces = 0;

	ps.ps_heading = null;

	var commit_text = function () {
		if (text !== '') {
			out.push(mod_ent.encode(text));
			text = '';
		}
	};

	for (var i = 0; i < desc.length; i++) {
		var c = desc[i];
		var cc = desc[i + 1];
		var ccc = desc[i + 2];
		var pc = i > 0 ? desc[i - 1] : null;

		mod_assert.notStrictEqual(c, '\n');
		mod_assert.notStrictEqual(c, '\r');

		switch (state) {
		case 'LEADING_SPACES':
			if (c === ' ') {
				leading_spaces++;
				continue;
			} else if ((c === '*' || c === '-') && cc === ' ') {
				if (!ps.ps_list) {
					out.push('<ul>');
				}
				ps.ps_list = true;
				commit_text();
				out.push('<li>');
				continue;
			}

			/*
			 * No special sequence was detected, so emit the
			 * spaces we counted, switch to the TEXT state, and
			 * wind back by one character so we reprocess the
			 * character we're looking at now.
			 */
			text += repeat_char(' ', leading_spaces);
			state = 'TEXT';
			i--;
			continue;

		case 'TEXT':
			if (ps.ps_list && i === 0 && c !== ' ') {
				commit_text();
				ps.ps_list = false;
				out.push('</ul>');

				/*
				 * Note that we must break out here, so that
				 * we don't drop this character.
				 */
				break;
			}

			if (i === 0 && c === 'h' && ccc === '.' &&
			    HEADING_LEVELS.indexOf(cc) !== -1) {
				ps.ps_heading = 'h' + cc;
				commit_text();
				out.push('<' + ps.ps_heading + '>');
				i += 3;
				continue;
			}

			if (c === '[') {
				commit_text();
				link_title = '';
				link_url = '';
				if (cc === '~') {
					i++; /* skip cc */
					state = 'LINK_USER';
				} else if (cc === '^') {
					i++; /* skip cc */
					state = 'LINK_ATTACHMENT';
				} else {
					state = 'LINK_TITLE';
				}
				continue;
			}
			break;

		case 'LINK_TITLE':
			if (c === '|') {
				state = 'LINK_URL';
			} else if (c === ']') {
				out.push('<a href="' + fix_url(link_title) +
				    '" target="_new">');
				out.push(mod_ent.encode(link_title));
				out.push('</a>');

				state = 'TEXT';
			} else {
				link_title += c;
			}
			continue;

		case 'LINK_USER':
			if (c === ']') {
				out.push('<b>@');
				out.push(mod_ent.encode(link_title));
				out.push('</b>');

				state = 'TEXT';
			} else {
				link_title += c;
			}
			continue;

		case 'LINK_ATTACHMENT':
			if (c === ']') {
				out.push('<b>[attachment ');
				out.push(mod_ent.encode(link_title));
				out.push(']</b>');

				state = 'TEXT';
			} else {
				link_title += c;
			}
			continue;

		case 'LINK_URL':
			if (c === ']') {
				out.push('<a href="' + fix_url(link_url) +
				    '" target="_new">');
				out.push(mod_ent.encode(link_title));
				out.push('</a>');

				state = 'TEXT';
			} else {
				link_url += c;
			}
			continue;
		}

		if (c === '*' && formats[0] !== 'CODE') {
			commit_text();
			if (formats[0] === 'BOLD') {
				formats.pop();
				out.push('</b>');
				continue;
			} else if (prefmtok(pc)) {
				formats.push('BOLD');
				out.push('<b>');
				continue;
			}
		}

		if (c === '_' && formats[0] !== 'CODE') {
			commit_text();
			if (formats[0] === 'ITALIC') {
				formats.pop();
				out.push('</i>');
				continue;
			} else if (prefmtok(pc)) {
				formats.push('ITALIC');
				out.push('<i>');
				continue;
			}
		}

		if (c === '{' && cc === '{') {
			i++; /* skip cc */
			formats.push('CODE');
			commit_text();
			out.push('<code>');
			continue;
		}

		if (c === '\\' && formats[0] === 'CODE') {
			/*
			 * Allow for basic escaping within {{code}} blocks
			 * by using the backslash.
			 */
			text += cc;
			i++;
			continue;
		}

		if (c === '}' && cc === '}' && formats[0] === 'CODE') {
			i++; /* skip cc */
			formats.pop();
			commit_text();
			out.push('</code>');
			continue;
		}

		text += c;
	}

	commit_text();
	if (ps.ps_heading !== null) {
		out.push('</' + ps.ps_heading + '>');
	}
	return (out.join(''));
}

function
format_markup(desc)
{
	var out = '';
	var lines = desc.split(/\r?\n/);

	var last_was_heading = false;
	var fmton = false;
	var newline_br = false;
	var parse_markup = true;
	var parser_state = {
		ps_list: false,
		ps_heading: null
	};
	for (var i = 0; i < lines.length; i++) {
		var line = lines[i];
		var lt_noformat = !!line.match(/^{noformat/);
		var lt_code = !!line.match(/^{code/);
		var lt_panel = !!line.match(/^{panel/);
		var lt_quote = !!line.match(/^{quote/);

		if (lt_noformat || lt_code || lt_panel || lt_quote) {
			if (parser_state.ps_list) {
				parser_state.ps_list = false;
				out += '</ul>\n';
			}
			if (fmton) {
				parse_markup = true;
				out += (lt_quote ? '</div>' : '</pre>') + '\n';
			} else if (lt_quote) {
				newline_br = true;
				parse_markup = true;
				out += '<div style="border-left: 2px solid ' +
				    '#888888; margin-left: 1em; ' +
				    'padding-left: 1em">\n';
			} else {
				newline_br = false;
				parse_markup = !(lt_noformat || lt_code);
				out += '<pre style="border: 2px solid black;' +
				    'font-family: Menlo, Courier, ' +
				    'Lucida Console, Monospace;' +
				    'background-color: #eeeeee;">\n';
			}
			fmton = !fmton;
		} else {
			if (parse_markup) {
				out += parse_jira_markup(line, parser_state);
			} else {
				out += mod_ent.encode(line);
			}
			if (fmton) {
				out += newline_br ? '<br>\n' : '\n';
			} else if (parser_state.ps_heading === null &&
			    !last_was_heading) {
				out += '<br>\n';
			}
		}

		last_was_heading = (parser_state.ps_heading !== null);
	}

	return (out);
}

function
format_issue_json(issue)
{
	var out = {
		id: issue.key,
		summary: issue.fields.summary,
		web_url: CONFIG.http_proto + '://smartos.org/bugview/' +
		    issue.key
	};

	return (JSON.stringify(out));
}

function
format_issue_title(issue)
{
	mod_assert.object(issue, 'issue');
	mod_assert.string(issue.key, 'issue.key');
	mod_assert.object(issue.fields, 'issue.fields');
	mod_assert.optionalString(issue.fields.summary,
	    'issue.fields.summary');

	var out = issue.key;

	if (issue.fields.summary) {
		out += ': ' + issue.fields.summary;
	}

	return (out);
}

function
format_issue(issue)
{
	var i;

	var out = '<h1>' + issue.key + ': ' + issue.fields.summary + '</h1>\n';

	if (issue.fields.resolution) {
		var rd = new Date(issue.fields.resolutiondate);

		out += '<h2>Resolution</h2>\n';
		out += '<p><b>' + issue.fields.resolution.name + ':</b> ' +
		    issue.fields.resolution.description + '<br>\n';
		out += '(Resolution Date: ' + rd.toISOString() + ' - ' +
                    mod_human(rd) + ')</p>\n';
	}

	if (issue.fields.fixVersions && issue.fields.fixVersions.length > 0) {
		out += '<h2>Fix Versions</h2>\n';
		for (i = 0; i < issue.fields.fixVersions.length; i++) {
			var fv = issue.fields.fixVersions[i];

			out += '<p><b>' + fv.name + '</b> (Release Date: ' +
			    fv.releaseDate + ' - ' +
                            mod_human(new Date(fv.releaseDate)) + ')</p>\n';
		}
	}

	if (issue.fields.issuelinks) {
		var links = [];

		for (i = 0; i < issue.fields.issuelinks.length; i++) {
			var il = issue.fields.issuelinks[i];

			if (il.outwardIssue &&
			    allow_issue(il.outwardIssue.key)) {
				links.push('<li>' + il.type.outward +
				    ' <a href="' + il.outwardIssue.key + '">' +
				    il.outwardIssue.key + '</a></li>');
			}

			if (il.inwardIssue &&
			    allow_issue(il.inwardIssue.key)) {
				links.push('<li>' + il.type.inward +
				    ' <a href="' + il.inwardIssue.key + '">' +
				    il.inwardIssue.key + '</a></li>');
			}
		}

		if (links.length > 0) {
			out += '<h2>Related Issues</h2>\n';
			out += '<p><ul>' + links.join('\n') + '</ul></p>\n';
		}
	}

	if (issue.fields.description) {
		out += '<h2>Description</h2>\n';
		out += '<div>';
		out += format_markup(issue.fields.description);
		out += '</div>\n';
	}

	if (issue.fields.comment) {
		out += '<h2>Comments</h2>\n';

		var c = issue.fields.comment;

		if (c.maxResults !== c.total) {
			LOG.error({
				issue: issue.key,
				total: c.total,
				maxResults: c.maxResults
			}, 'comment maxResults and total not equal for issue');
		}

		var dark = false;
		for (i = 0; i < c.comments.length; i++) {
			var com = c.comments[i];

			if (com.visibility) {
				/*
				 * For now, skip comments with _any_
				 * visibility rules.
				 */
				continue;
			}

			var cdtc = new Date(com.created);

			out += '<div style="background-color: ' +
			    (dark ? '#DDDDDD' : '#EEEEEE') + ';">\n';
			out += '<b>';
			out += 'Comment by ' + com.author.displayName + '<br>\n';
			out += 'Created at ' + cdtc.toISOString() +
			    ' (' + mod_human(cdtc) + ')<br>\n';
			if (com.updated && com.updated !== com.created) {
				var cdtu = new Date(com.updated);
				out += 'Updated at ' +
				    cdtu.toISOString() +
				    ' (' + mod_human(cdtu) + ')<br>\n';
			}
			out += '</b>';
			out += format_markup(com.body);
			out += '</div><br>\n';

			dark = !dark;
		}
	}

	return (out);
}

/*
 * Main:
 */

function
main() {
	read_templates(LOG);

	create_http_server(LOG, function (s) {
		SERVER = s;
	});

	JIRA = mod_restify.createJsonClient({
		url: CONFIG.url.base,
		connectTimeout: 15000,
		userAgent: 'JoyentJIRAPublicAccess',
		log: LOG.child({
			component: 'jira'
		})
	});
	JIRA.basicAuth(CONFIG.username, CONFIG.password);
}

main();
