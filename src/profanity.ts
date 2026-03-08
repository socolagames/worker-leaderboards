// ── Profanity filter ──────────────────────────────────────────────────────────
// Normalises the input (leet-speak, symbols, repeated chars) then checks for
// substring matches against the blocklist.  Substring matching catches compound
// words like "fuckface" without needing to enumerate every variant.

function normalize(text: string): string {
	return text
		.toLowerCase()
		// symbol → letter substitutions (before stripping non-alpha)
		.replace(/@/g, 'a')
		.replace(/\$/g, 's')
		.replace(/!/g, 'i')
		.replace(/\|/g, 'i')
		.replace(/\+/g, 't')
		// leet digit substitutions
		.replace(/0/g, 'o')
		.replace(/1/g, 'i')
		.replace(/3/g, 'e')
		.replace(/4/g, 'a')
		.replace(/5/g, 's')
		.replace(/7/g, 't')
		.replace(/8/g, 'b')
		// strip everything that's not a letter
		.replace(/[^a-z]/g, '')
		// collapse runs of the same letter: "fuuuck" → "fuk", "niiiiga" → "niga"
		.replace(/(.)\1+/g, '$1');
}

// Blocklist — words we never want on the leaderboard.
// Normalization handles creative spellings; substring matching handles compounds.
// Deliberately excludes mild words ('damn', 'crap', 'ass') to avoid
// false-positives on legitimate names (Damien, Crapper, Bassett, etc.).
const BLOCKLIST: string[] = [
	// Racial & ethnic slurs
	'niga', 'niger', 'nigr',         // normalised forms of the n-slur
	'kike', 'spic', 'spik', 'chink',
	'gok',                            // normalised "gook"
	'wetbak', 'beanr',
	'coon', 'jigabo', 'sambo',
	'raghed', 'towelhed',
	'wop', 'dago', 'polak', 'kraut', 'hymie',
	'redskin', 'squaw', 'injun',
	'ziperhad',                       // normalised "zipper-head"
	'sandniger',                      // compound
	// Homophobic / transphobic slurs
	'fagot', 'fag',
	'dyke',
	'trany',                          // normalised "tranny"
	// Sexual profanity
	'fuk',                            // normalised "fuck" (fuuuck → fuk)
	'cunt',
	'kok',                            // normalised "cock"
	'shit',
	'ashole',                         // normalised "asshole"
	'bich',                           // normalised "bitch"
	'twat',
	'prik',                           // normalised "prick"
	'pus',                            // "pussy" normalises to "pus" after collapse
	'dik',                            // "dick"
	'cumshot', 'cumslut', 'cumdump',
	'jizm', 'jiz',
	'pedofil', 'pedo',
	'rapist',
	// Hate-group references
	'neonazi', 'nazism',
	'kkk',
	'whitepow',                       // "white power"
	'1488',                           // nazi numeric code (pre-normalization check below)
];

// Some codes are numeric and shouldn't be collapsed by normalization.
// Check these against the original (lowercased, symbols stripped) text.
const BLOCKLIST_RAW: string[] = [
	'1488', '14/88', '14-88',
	'h8', '88',
];

export function containsProfanity(playerName: string): boolean {
	const norm = normalize(playerName);
	if (BLOCKLIST.some(word => norm.includes(word))) return true;

	const raw = playerName.toLowerCase().replace(/[^a-z0-9/\-]/g, '');
	if (BLOCKLIST_RAW.some(word => raw.includes(word.replace(/[^a-z0-9/\-]/g, '')))) return true;

	return false;
}
