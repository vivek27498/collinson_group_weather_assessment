import { readFileSync } from 'node:fs';
import path from 'node:path';

/**
 * Real Open-Meteo responses recorded on 2026-10-06 (see test/fixtures/open-meteo/).
 * Testing against recorded payloads catches mapping mistakes that hand-written mocks would
 * happily agree with.
 */
export type OpenMeteoFixture =
  | 'geocode-chamonix'
  | 'geocode-biarritz'
  | 'geocode-paris'
  | 'geocode-paris-us'
  | 'geocode-empty'
  | 'forecast-chamonix'
  | 'forecast-biarritz'
  | 'marine-biarritz'
  | 'marine-inland-chamonix';

export function loadFixture(name: OpenMeteoFixture): unknown {
  const file = path.join(__dirname, '..', 'fixtures', 'open-meteo', `${name}.json`);
  return JSON.parse(readFileSync(file, 'utf8')) as unknown;
}
