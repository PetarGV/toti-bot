import { prepare } from '../db/client.js';
import { chebyshev } from '../utils/defMath.js';

export function loadThresholds() {
  const get = key => Number(prepare('SELECT value FROM config WHERE key=?').get(key)?.value);
  return {
    chiefMinWaves:   get('threat_chief_min_waves')   || 4,
    chiefTimingSec:  get('threat_chief_timing_sec')  || 30,
    focusWindowHrs:  get('threat_focus_window_hrs')  || 6,
    scatterRadius:   get('threat_scatter_radius')    || 5,
    realMinWaves:    get('threat_real_min_waves')    || 2,
  };
}

/**
 * Pure classifier. Does not read from DB.
 * @param {object} report — incoming_reports row being classified
 * @param {object[]} allOtherReports — other rows to consider for cascade/scatter
 * @param {{chiefMinWaves,chiefTimingSec,focusWindowHrs,scatterRadius,realMinWaves}} t
 */
export function classifyThreat(report, allOtherReports, t) {
  const sameAttackerTight = allOtherReports.filter(r =>
    r.id !== report.id
    && r.attacker_x === report.attacker_x && r.attacker_y === report.attacker_y
    && Math.abs(r.first_eta - report.first_eta) <= t.chiefTimingSec
  );
  const sameAttackerTightSameDefender = sameAttackerTight.filter(r =>
    r.defender_x === report.defender_x && r.defender_y === report.defender_y
  );

  if (report.waves >= t.chiefMinWaves || sameAttackerTightSameDefender.length >= t.chiefMinWaves - 1) {
    return 'chief';
  }
  if (report.waves >= t.realMinWaves) {
    return 'real';
  }

  // Single-wave: scatter check across same-attacker in focus window
  const windowSec = t.focusWindowHrs * 3600;
  const focusWindow = allOtherReports.filter(r =>
    r.id !== report.id
    && r.attacker_x === report.attacker_x && r.attacker_y === report.attacker_y
    && Math.abs(r.first_eta - report.first_eta) <= windowSec
  );
  const allDefenders = [{ x: report.defender_x, y: report.defender_y }, ...focusWindow.map(r => ({ x: r.defender_x, y: r.defender_y }))];
  // any pair > scatterRadius
  for (let i = 0; i < allDefenders.length; i++) {
    for (let j = i + 1; j < allDefenders.length; j++) {
      if (chebyshev(allDefenders[i], allDefenders[j]) > t.scatterRadius) return 'fake';
    }
  }
  return 'real';
}

/**
 * Reads the report and all related candidate rows from DB, runs classifier,
 * writes back threat_class. Returns the new class.
 * Honors threat_override: if set, no auto-classification is written.
 */
export function classifyAndPersist(reportId) {
  const report = prepare('SELECT * FROM incoming_reports WHERE id = ?').get(reportId);
  if (!report) return null;
  if (report.threat_override) return report.threat_override;
  const t = loadThresholds();
  const windowSec = t.focusWindowHrs * 3600;
  const candidates = prepare(`
    SELECT * FROM incoming_reports
    WHERE id != ?
      AND attacker_x = ? AND attacker_y = ?
      AND ABS(first_eta - ?) <= ?
  `).all(reportId, report.attacker_x, report.attacker_y, report.first_eta, windowSec);
  const cls = classifyThreat(report, candidates, t);
  prepare('UPDATE incoming_reports SET threat_class = ? WHERE id = ?').run(cls, reportId);
  return cls;
}

/**
 * After classifying report R, upgrade any related reports (same attacker,
 * tight timing) that lack an override to 'chief' if R is 'chief'.
 * Returns the list of report IDs whose class changed.
 */
export function cascadeChiefFrom(reportId) {
  const r = prepare('SELECT * FROM incoming_reports WHERE id = ?').get(reportId);
  if (!r) return [];
  const effective = r.threat_override || r.threat_class;
  if (effective !== 'chief') return [];
  const t = loadThresholds();
  const related = prepare(`
    SELECT id, threat_class FROM incoming_reports
    WHERE id != ?
      AND attacker_x = ? AND attacker_y = ?
      AND ABS(first_eta - ?) <= ?
      AND threat_override IS NULL
      AND threat_class != 'chief'
  `).all(reportId, r.attacker_x, r.attacker_y, r.first_eta, t.chiefTimingSec);
  const changed = [];
  for (const row of related) {
    prepare('UPDATE incoming_reports SET threat_class = ? WHERE id = ?').run('chief', row.id);
    changed.push(row.id);
  }
  return changed;
}
