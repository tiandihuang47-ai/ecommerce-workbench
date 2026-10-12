import ms from "ms";

const raw = process.argv[2] || "{}";
let payload = {};
try {
  payload = JSON.parse(raw);
} catch {
  payload = {};
}

const durations = Array.isArray(payload.durations) ? payload.durations : [1500, 92000];
const human = durations.map((value) => ms(Number(value) || 0));

console.log(JSON.stringify({ ok: true, human }));
