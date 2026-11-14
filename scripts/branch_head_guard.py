#!/usr/bin/env python3
"""Fail closed unless this run still targets the exact GitHub branch head."""
import argparse
from http.client import HTTPException
import json
import os
from pathlib import Path
import re
import urllib.request


class NoRedirect(urllib.request.HTTPRedirectHandler):
    def redirect_request(self, req, fp, code, msg, headers, newurl):
        # Never forward the ephemeral token to a redirected host.
        raise RuntimeError('GitHub branch-head lookup refused a redirect')


def validate(repository, ref, revision):
    if (not re.fullmatch(r'[A-Za-z0-9](?:[A-Za-z0-9-]{0,38})/[A-Za-z0-9_.-]{1,100}', repository)
            or repository.split('/')[-1] in {'.', '..'}):
        raise ValueError('Invalid GitHub repository')
    if ref != 'refs/heads/master':
        raise ValueError('Only exact deployment branch refs are permitted')
    if not re.fullmatch(r'[0-9a-f]{40}', revision):
        raise ValueError('Revision must be an exact lowercase Git commit SHA')


def should_deploy(repository, ref, revision, token):
    validate(repository, ref, revision)
    if not token or any(char.isspace() for char in token):
        raise RuntimeError('Missing or invalid GitHub token')
    request = urllib.request.Request(
        'https://api.github.com/repos/' + repository + '/git/ref/' + ref.removeprefix('refs/'),
        headers={'Authorization': 'Bearer ' + token, 'Accept': 'application/vnd.github+json',
                 'X-GitHub-Api-Version': '2022-11-28', 'User-Agent': 'mikolaj-branch-head-guard',
                 'Cache-Control': 'no-cache'},
        method='GET',
    )
    try:
        with urllib.request.build_opener(NoRedirect()).open(request, timeout=25) as response:
            if response.status != 200:
                raise ValueError('Unexpected status')
            result = json.load(response)
        if not isinstance(result, dict) or result.get('ref') != ref:
            raise ValueError('Unexpected ref')
        commit = result.get('object')
        if (not isinstance(commit, dict) or commit.get('type') != 'commit'
                or not isinstance(commit.get('sha'), str)
                or not re.fullmatch(r'[0-9a-f]{40}', commit['sha'])):
            raise ValueError('Unexpected commit')
    except (OSError, HTTPException, ValueError, RuntimeError):
        # Do not echo response bodies, authorization, or exception text.
        raise RuntimeError('GitHub branch-head lookup failed; deployment refused') from None
    return commit['sha'] == revision


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument('--repository', required=True)
    parser.add_argument('--ref', required=True)
    parser.add_argument('--revision', required=True)
    args = parser.parse_args()
    try:
        deploy = should_deploy(args.repository, args.ref, args.revision, os.environ.get('GITHUB_TOKEN', ''))
    except (ValueError, RuntimeError):
        with Path(os.environ['GITHUB_OUTPUT']).open('a') as output:
            output.write('deploy=false\n')
        raise SystemExit('Branch-head guard failed; deployment refused') from None
    with Path(os.environ['GITHUB_OUTPUT']).open('a') as output:
        output.write('deploy=' + ('true' if deploy else 'false') + '\n')
    if deploy:
        print('Branch head matches this run; deployment permitted.')
    else:
        print('Superseded run: current branch head differs; deployment skipped.')


if __name__ == '__main__':
    main()
