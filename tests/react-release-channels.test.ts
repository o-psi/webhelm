import test from 'node:test';
import assert from 'node:assert/strict';
import {checkReleaseChannel,compareReleaseVersions,installedReleaseChannel,isNewerOnInstalledChannel,publishedRelease} from '../resources/js/release-channels.js';

const target='x86_64-unknown-linux-gnu';
const assets=version=>[
    {name:`voyage-${version}-${target}.tar.gz`,size:100},
    {name:`voyage-${version}-${target}.tar.gz.sha256`,size:100},
];

test('published channel checks are read-only hints with SemVer ordering',async()=>{
    const stable={tag_name:'v1.0.2',draft:false,prerelease:false,assets:assets('v1.0.2')};
    const nightly=version=>({tag_name:`nightly-${version}`,draft:false,prerelease:true,target_commitish:'a'.repeat(40),assets:assets(version)});
    const releases=[nightly('1.0.3-nightly.20260928.12.1'),nightly('1.0.3-nightly.20260928.13.1')];
    assert.equal(publishedRelease('stable',stable),'v1.0.2');
    assert.equal(publishedRelease('nightly',releases),'1.0.3-nightly.20260928.13.1');
    assert.equal(publishedRelease('nightly',[{...releases[1],assets:[]}]),null,'a release without both assets is not shown');
    assert.equal(publishedRelease('stable',{...stable,draft:true}),null);
    assert.equal(compareReleaseVersions('v1.0.2','1.0.2'),0);
    assert.equal(compareReleaseVersions('1.0.3-nightly.20260928.13.1','v1.0.2'),1);
    assert.equal(compareReleaseVersions('v1.0.3','1.0.3-nightly.20260928.13.1'),1);
    assert.equal(compareReleaseVersions('unknown','v1.0.2'),null);
    assert.equal(installedReleaseChannel('1.0.2'),'stable');
    assert.equal(installedReleaseChannel('1.0.3-nightly.20260928.12.1'),'nightly');
    assert.equal(installedReleaseChannel('unknown'),null);
    assert.equal(isNewerOnInstalledChannel('nightly','1.0.3-nightly.20260928.13.1','1.0.2'),false,'another channel does not raise a badge');
    assert.equal(isNewerOnInstalledChannel('stable','v1.0.3','1.0.2'),true);
    assert.equal(isNewerOnInstalledChannel('nightly','1.0.3-nightly.20260928.13.1','1.0.3-nightly.20260928.12.1'),true);
    assert.equal(isNewerOnInstalledChannel('stable','v1.0.2','1.0.2'),false);
    const oldFetch=globalThis.fetch, urls=[];
    globalThis.fetch=async url=>{urls.push(String(url));return new Response(JSON.stringify(urls.length===1?stable:releases));};
    try {
        assert.equal(await checkReleaseChannel('stable'),'v1.0.2');
        assert.equal(await checkReleaseChannel('nightly'),'1.0.3-nightly.20260928.13.1');
        assert.deepEqual(urls,[
            'https://api.github.com/repos/o-psi/helm.vessel.voyage/releases/latest',
            'https://api.github.com/repos/o-psi/helm.vessel.voyage/releases?per_page=100',
        ]);
        await assert.rejects(checkReleaseChannel('other'),/Unknown release channel/);
    } finally {globalThis.fetch=oldFetch;}
});
