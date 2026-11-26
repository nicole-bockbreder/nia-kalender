// Nia-Kalender-Feed: liest die Kurse aus dem Sanity-Studio von nicole-bockbreder.de
// ("Kurs-Termine (FABI + OSC)") und schreibt daraus eine Kalender-Datei (docs/nia.ics),
// die Google Kalender abonnieren kann. Keine Zusatz-Pakete nötig (Node 18+).

import { mkdirSync, writeFileSync } from 'node:fs'

const API = 'https://oa3zdz7g.apicdn.sanity.io/v2024-01-01/data/query/production'
const QUERY = '*[_type=="niaKurs" && active==true]'
const ORTE = {
  FABI: 'Ev. Fabi, OG, Raum 21, Anna-Gastvogel-Straße 1, 49080 Osnabrück',
  OSC: 'Osnabrücker Sportclub (OSC), KidsZ-Gebäude (Hinterhof), 1. Stock, Hiärm-Grupe-Straße 8, 49080 Osnabrück',
}
const TAGE = { MONTAGS: 1, DIENSTAGS: 2, MITTWOCHS: 3, DONNERSTAGS: 4, FREITAGS: 5, SAMSTAGS: 6, SONNTAGS: 0 }
const WOCHE = 7 * 86400000

const iso = t => new Date(t).toISOString().slice(0, 10)
const tag = (j, m, d) => Date.UTC(j, m - 1, d)

// "12.01. – 16.03.2027" → [Start, Ende] als UTC-Millisekunden
export function zeitraum(text) {
  const z = [...text.matchAll(/(\d{1,2})\.(\d{1,2})\.(\d{2,4})?/g)]
  if (z.length < 2) throw new Error('Zeitraum nicht lesbar: ' + text)
  const jahr = s => (s ? (s.length === 2 ? 2000 + Number(s) : Number(s)) : null)
  const ej = jahr(z[1][3])
  if (ej === null) throw new Error('Zeitraum ohne Jahr: ' + text)
  const em = Number(z[1][2])
  const sm = Number(z[0][2])
  const sj = jahr(z[0][3]) ?? (sm > em ? ej - 1 : ej)
  return [tag(sj, sm, Number(z[0][1])), tag(ej, em, Number(z[1][1]))]
}

// "nicht am 26.05. & 23.06.26" → Set von 'JJJJ-MM-TT' (Jahr ohne Angabe: passend zum Zeitraum)
export function ausnahmen(text, start, ende) {
  const raus = new Set()
  if (!text) return raus
  for (const m of text.matchAll(/(\d{1,2})\.(\d{1,2})\.(\d{2,4})?/g)) {
    const d = Number(m[1]), mo = Number(m[2])
    let jahre = m[3] ? [m[3].length === 2 ? 2000 + Number(m[3]) : Number(m[3])] : [new Date(start).getUTCFullYear(), new Date(ende).getUTCFullYear()]
    for (const j of jahre) {
      const t = tag(j, mo, d)
      if (t >= start && t <= ende) raus.add(iso(t))
    }
  }
  return raus
}

// "18:15 – 19:15 Uhr" → ['1815', '1915']
export function uhrzeit(text) {
  const z = [...text.matchAll(/(\d{1,2}):(\d{2})/g)]
  if (z.length < 2) throw new Error('Uhrzeit nicht lesbar: ' + text)
  return z.slice(0, 2).map(x => x[1].padStart(2, '0') + x[2])
}

export function termine(kurs) {
  const [start, ende] = zeitraum(kurs.dateRange || '')
  const wt = TAGE[(kurs.weekday || '').toUpperCase().trim()]
  if (wt === undefined) throw new Error('Wochentag nicht lesbar: ' + kurs.weekday)
  if (new Date(start).getUTCDay() !== wt) throw new Error(`Startdatum ${iso(start)} ist kein ${kurs.weekday}`)
  const raus = ausnahmen(kurs.exceptions, start, ende)
  const [von, bis] = uhrzeit(kurs.timeSlot || '')
  const liste = []
  for (let t = start; t <= ende; t += WOCHE) if (!raus.has(iso(t))) liste.push({ datum: iso(t).replace(/-/g, ''), von, bis })
  return liste
}

const esc = s => String(s).replace(/\\/g, '\\\\').replace(/;/g, '\\;').replace(/,/g, '\\,').replace(/\n/g, '\\n')
const falten = zeile => {
  const out = []
  let rest = zeile
  while (Buffer.byteLength(rest) > 73) {
    let n = 73
    while (Buffer.byteLength(rest.slice(0, n)) > 73) n--
    out.push(rest.slice(0, n))
    rest = ' ' + rest.slice(n)
  }
  out.push(rest)
  return out.join('\r\n')
}

function titelUndOrt(kurs) {
  const osc = /OSC|Sportclub/i.test(kurs.location || '')
  if (osc) return { titel: 'Nia OSC' + (kurs.courseNumber ? ' · Kurs Nr. ' + kurs.courseNumber : ''), ort: ORTE.OSC }
  const nr = (kurs.bookingUrl || '').match(/[A-Z]\d{2}-\d{3}/)
  const spezial = /MITTWOCH/i.test(kurs.weekday || '') ? ' · Special Nia' : ''
  return { titel: 'Nia FABI' + spezial + (nr ? ' (' + nr[0] + ')' : ''), ort: ORTE.FABI }
}

const VTIMEZONE = [
  'BEGIN:VTIMEZONE', 'TZID:Europe/Berlin',
  'BEGIN:DAYLIGHT', 'TZOFFSETFROM:+0100', 'TZOFFSETTO:+0200', 'TZNAME:CEST', 'DTSTART:19700329T020000', 'RRULE:FREQ=YEARLY;BYMONTH=3;BYDAY=-1SU', 'END:DAYLIGHT',
  'BEGIN:STANDARD', 'TZOFFSETFROM:+0200', 'TZOFFSETTO:+0100', 'TZNAME:CET', 'DTSTART:19701025T030000', 'RRULE:FREQ=YEARLY;BYMONTH=10;BYDAY=-1SU', 'END:STANDARD',
  'END:VTIMEZONE',
]

export function ics(kurse, jetzt = new Date()) {
  const stempel = jetzt.toISOString().replace(/[-:]/g, '').slice(0, 15) + 'Z'
  const zeilen = ['BEGIN:VCALENDAR', 'VERSION:2.0', 'PRODID:-//nicole-bockbreder//nia-kalender//DE', 'CALSCALE:GREGORIAN', 'METHOD:PUBLISH',
    'X-WR-CALNAME:Nia-Kurse', 'X-WR-TIMEZONE:Europe/Berlin', 'REFRESH-INTERVAL;VALUE=DURATION:PT6H', 'X-PUBLISHED-TTL:PT6H', ...VTIMEZONE]
  const fehler = []
  let anzahl = 0
  for (const k of kurse) {
    let liste
    try { liste = termine(k) } catch (e) { fehler.push(`${k.weekday} ${k.dateRange}: ${e.message}`); continue }
    const { titel, ort } = titelUndOrt(k)
    for (const t of liste) {
      zeilen.push('BEGIN:VEVENT', `UID:${k._id}-${t.datum}@nicole-bockbreder.de`, `DTSTAMP:${stempel}`,
        `DTSTART;TZID=Europe/Berlin:${t.datum}T${t.von}00`, `DTEND;TZID=Europe/Berlin:${t.datum}T${t.bis}00`,
        `SUMMARY:${esc(titel)}`, `LOCATION:${esc(ort)}`,
        `DESCRIPTION:${esc('Automatisch von nicole-bockbreder.de (Sanity-Studio). Ändern nur im Studio.' + (k.bookingUrl ? '\n' + k.bookingUrl : ''))}`,
        'TRANSP:OPAQUE', 'END:VEVENT')
      anzahl++
    }
  }
  zeilen.push('END:VCALENDAR')
  return { text: zeilen.map(falten).join('\r\n') + '\r\n', anzahl, fehler }
}

async function main() {
  const res = await fetch(API + '?query=' + encodeURIComponent(QUERY))
  if (!res.ok) throw new Error('Sanity antwortet nicht: ' + res.status)
  const kurse = (await res.json()).result
  if (!Array.isArray(kurse) || kurse.length === 0) throw new Error('Keine Kurse gefunden – alte Datei bleibt stehen.')
  const { text, anzahl, fehler } = ics(kurse)
  if (anzahl === 0) throw new Error('0 Termine – alte Datei bleibt stehen.')
  mkdirSync('docs', { recursive: true })
  writeFileSync('docs/nia.ics', text)
  console.log(`${anzahl} Termine aus ${kurse.length} Kursen geschrieben.`)
  if (fehler.length) {
    console.log('Nicht lesbar (übersprungen):\n- ' + fehler.join('\n- '))
    process.exitCode = 1 // GitHub zeigt den Lauf dann rot → Hinweis, dass im Studio etwas nicht stimmt
  }
}

if (import.meta.url === `file:///${process.argv[1].replace(/\\/g, '/')}` || process.argv[1]?.endsWith('feed.mjs')) {
  main().catch(e => { console.error(e.message); process.exit(1) })
}
