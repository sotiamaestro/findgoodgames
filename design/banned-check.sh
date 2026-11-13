#!/usr/bin/env sh
# Greps the built CSS/HTML and the site copy for the brief's banned list.
# Exit code 1 when anything is found.
set -u
fail=0
echo "== banned fonts in built output and source =="
if grep -rniE "inter|geist|roboto|space grotesk|satoshi|manrope|fraunces|bricolage" dist/index.html src/styles/ index.html | grep -viE "interact|intern|pointer|interse|center|interval|interface|printer|winter|interpret|counter|filter|enter|interest|internal|terrain" ; then fail=1; else echo "none"; fi
echo "== purple / indigo / violet (names and hue ranges) =="
if grep -rniE "purple|indigo|violet|lavender|magenta" dist/index.html src/ index.html ; then fail=1; else echo "no named purples"; fi
node -e '
const fs=require("fs");const css=fs.readFileSync("dist/index.html","utf8");
const hexes=[...css.matchAll(/#([0-9a-f]{6}|[0-9a-f]{3})\b/gi)].map(m=>m[0]);
const bad=[];for(const h of new Set(hexes)){let x=h.slice(1);if(x.length===3)x=x.split("").map(c=>c+c).join("");const r=parseInt(x.slice(0,2),16)/255,g=parseInt(x.slice(2,4),16)/255,b=parseInt(x.slice(4,6),16)/255;const max=Math.max(r,g,b),min=Math.min(r,g,b),d=max-min;if(d<0.08)continue;let hue=0;if(max===r)hue=((g-b)/d)%6;else if(max===g)hue=(b-r)/d+2;else hue=(r-g)/d+4;hue=(hue*60+360)%360;if(hue>=250&&hue<=320)bad.push(h+" hue "+hue.toFixed(0));}
if(bad.length){console.log("purple-range hex colours:",bad);process.exit(1)}else console.log("no hex colours between hue 250 and 320")
' || fail=1
echo "== em dashes in copy =="
if grep -rn "—" src/ index.html public/robots.txt README.md DESIGN.md DECISIONS.md design/review.md netlify/ 2>/dev/null; then fail=1; else echo "none"; fi
echo "== gradient text / glass / glow =="
if grep -rniE "background-clip:\s*text|backdrop-filter|text-shadow|box-shadow:[^;]*(0 0 [0-9]+px [0-9]+px|rgba\([^)]*,\s*0\.[5-9])" dist/index.html; then fail=1; else echo "none"; fi
exit $fail
