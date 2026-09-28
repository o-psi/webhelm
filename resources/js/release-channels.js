// Public metadata is only a hint for Helm's update UI. The Vessel independently
// downloads and verifies an exact build after the owner chooses Prepare.
const api = 'https://api.github.com/repos/o-psi/helm.vessel.voyage';
const target = 'x86_64-unknown-linux-gnu';
const stableTag = /^v[0-9]+\.[0-9]+\.[0-9]+$/;
const nightlyTag = /^nightly-([0-9]+\.[0-9]+\.[0-9]+-nightly\.[0-9]{8}\.[0-9]+\.[0-9]+)$/;

function assetsPresent(release, version) {
    const archive = `voyage-${version}-${target}.tar.gz`;
    return [[archive, 536870912], [`${archive}.sha256`, 4096]].every(([name, limit]) =>
        release.assets?.some(asset => asset?.name === name && Number.isSafeInteger(asset.size) && asset.size > 0 && asset.size <= limit));
}

function parseVersion(value) {
    const match = /^v?([0-9]+)\.([0-9]+)\.([0-9]+)(?:-nightly\.([0-9]{8})\.([0-9]+)\.([0-9]+))?$/.exec(value || '');
    return match ? match.slice(1).map(part => part === undefined ? null : BigInt(part)) : null;
}

// Null means an installed version has an unknown format; don't guess its order.
export function compareReleaseVersions(a, b) {
    const left = parseVersion(a), right = parseVersion(b);
    if (!left || !right) return null;
    for (let i = 0; i < 3; i++) {
        if (left[i] !== right[i]) return left[i] > right[i] ? 1 : -1;
    }
    if (left[3] === null || right[3] === null) return left[3] === right[3] ? 0 : left[3] === null ? 1 : -1;
    for (let i = 3; i < 6; i++) {
        if (left[i] !== right[i]) return left[i] > right[i] ? 1 : -1;
    }
    return 0;
}

export function publishedRelease(channel, data) {
    if (channel === 'stable') {
        return data && data.draft === false && data.prerelease === false
            && stableTag.test(data.tag_name) && assetsPresent(data, data.tag_name) ? data.tag_name : null;
    }
    if (channel !== 'nightly' || !Array.isArray(data)) return null;
    const versions = data.flatMap(release => {
        const match = nightlyTag.exec(release?.tag_name || '');
        return match && release.draft === false && release.prerelease === true
            && /^[a-f0-9]{40}$/.test(release.target_commitish || '') && assetsPresent(release, match[1]) ? [match[1]] : [];
    });
    return versions.reduce((latest, version) => !latest || compareReleaseVersions(version, latest) > 0 ? version : latest, null);
}

export async function checkReleaseChannel(channel, signal) {
    if (!['stable', 'nightly'].includes(channel)) throw new Error('Unknown release channel');
    const path = channel === 'stable' ? 'releases/latest' : 'releases?per_page=100';
    const response = await fetch(`${api}/${path}`, {headers: {Accept: 'application/vnd.github+json'}, signal});
    if (!response.ok) throw new Error('Release metadata unavailable');
    const body = await response.text();
    if (body.length > (channel === 'stable' ? 1048576 : 4194304)) throw new Error('Release metadata too large');
    return publishedRelease(channel, JSON.parse(body));
}
