// Smoke test: parse all editions, print team/player counts, league vocab, warnings.
import { EDITIONS, loadPage, parseEdition, ScrapedPlayer } from './lib/wikipedia.js';

const all: ScrapedPlayer[] = [];
for (const year of EDITIONS) {
  const { html, url, retrievedAt } = await loadPage(year);
  const { players, teams, warnings } = parseEdition(year, html, { url, retrievedAt });
  console.log(`${year}: ${teams.size} teams, ${players.length} players`);
  for (const w of warnings) console.log(`  WARN [${w.country ?? '-'}] ${w.message}`);
  const perTeam = new Map<string, number>();
  for (const p of players) perTeam.set(p.country, (perTeam.get(p.country) ?? 0) + 1);
  const counts = [...perTeam.entries()].map(([c, n]) => `${c}:${n}`).join(' ');
  console.log(`  ${counts}`);
  all.push(...players);
}
console.log('\nDistinct league strings:');
const leagues = new Map<string, number>();
for (const p of all) if (p.leagueRaw) leagues.set(p.leagueRaw, (leagues.get(p.leagueRaw) ?? 0) + 1);
for (const [l, n] of [...leagues.entries()].sort((a, b) => b[1] - a[1])) console.log(`  ${n}\t${l}`);
console.log(`\nDOB coverage: ${all.filter((p) => p.dob).length}/${all.length}`);
const hitters = all.filter((p) => !p.posGroups.includes('P'));
console.log(`Hitters (non-P groups): ${hitters.length}`);
