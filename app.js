// MPC <-> Ableton Drum Rack — konwersja po stronie przeglądarki.
// Czysta logika (bez DOM) jest też testowalna w Node 22.
(function (G) {
  "use strict";
  const TEMPLATES = G.TEMPLATES;

  // ----------------------------------------------------------------- utils
  const NOTE_OFFSET = 35;          // pad MPC N <-> nuta 35+N (pad 1 = C1 = 36)
  const MAX_PADS = 128;
  const MPC_DEFAULT_VOLUME = 0.707946;
  const MPC_DEFAULT_PAN = 0.5;

  function xmlEscape(s) {
    return String(s).replace(/&/g, "&amp;").replace(/</g, "&lt;")
      .replace(/>/g, "&gt;").replace(/"/g, "&quot;");
  }
  function f6(x) { return Number(x).toFixed(6); }
  function baseNoExt(name) {
    const b = String(name).split(/[\\/]/).pop();
    const i = b.lastIndexOf(".");
    return i > 0 ? b.slice(0, i) : b;
  }

  // głośność Simplera (dB) -> głośność instrumentu MPC: dB = 40*log10(v)+6
  function dbToMpcVolume(db) {
    const v = Math.pow(10, (db - 6) / 40);
    return Math.min(Math.max(v, 0), 1);
  }
  // odwrotnie (przy forward): MPC volume (0..1) -> dB Simplera
  function mpcVolumeToDb(v) {
    if (v <= 0) return -60;
    return 40 * Math.log10(v) + 6;
  }

  // ----------------------------------------------------------------- gzip
  async function gunzip(u8) {
    const ds = new DecompressionStream("gzip");
    const stream = new Blob([u8]).stream().pipeThrough(ds);
    return new Uint8Array(await new Response(stream).arrayBuffer());
  }
  async function gzip(u8) {
    const cs = new CompressionStream("gzip");
    const stream = new Blob([u8]).stream().pipeThrough(cs);
    return new Uint8Array(await new Response(stream).arrayBuffer());
  }

  // ----------------------------------------------------------------- WAV
  function wavFrames(buf) {
    try {
      const dv = new DataView(buf);
      if (dv.byteLength < 12) return 0;
      if (dv.getUint32(0, false) !== 0x52494646) return 0;     // 'RIFF'
      if (dv.getUint32(8, false) !== 0x57415645) return 0;     // 'WAVE'
      let off = 12, blockAlign = 0;
      while (off + 8 <= dv.byteLength) {
        const id = dv.getUint32(off, false);
        const size = dv.getUint32(off + 4, true);
        if (id === 0x666d7420) {                               // 'fmt '
          if (off + 8 + 14 <= dv.byteLength)
            blockAlign = dv.getUint16(off + 8 + 12, true);
        } else if (id === 0x64617461) {                        // 'data'
          if (blockAlign) return Math.floor(size / blockAlign);
          return 0;
        }
        off += 8 + size + (size & 1);
      }
    } catch (e) { /* ignore */ }
    return 0;
  }

  // ----------------------------------------------------------------- ZIP (store)
  const CRC_TABLE = (function () {
    const t = new Uint32Array(256);
    for (let n = 0; n < 256; n++) {
      let c = n;
      for (let k = 0; k < 8; k++) c = (c & 1) ? (0xEDB88320 ^ (c >>> 1)) : (c >>> 1);
      t[n] = c >>> 0;
    }
    return t;
  })();
  function crc32(u8) {
    let c = 0xFFFFFFFF;
    for (let i = 0; i < u8.length; i++) c = CRC_TABLE[(c ^ u8[i]) & 0xFF] ^ (c >>> 8);
    return (c ^ 0xFFFFFFFF) >>> 0;
  }
  // files: [{name, data: Uint8Array}] -> Uint8Array (zip, metoda 0 = store)
  function makeZip(files) {
    const enc = new TextEncoder();
    const chunks = [];
    const central = [];
    let offset = 0;
    const DOS_TIME = 0, DOS_DATE = 0x21; // 1980-01-01
    for (const f of files) {
      const nameBytes = enc.encode(f.name);
      const crc = crc32(f.data);
      const size = f.data.length;
      const lh = new Uint8Array(30 + nameBytes.length);
      const dv = new DataView(lh.buffer);
      dv.setUint32(0, 0x04034b50, true);
      dv.setUint16(4, 20, true);            // version needed
      dv.setUint16(6, 0x0800, true);        // flags: UTF-8 names
      dv.setUint16(8, 0, true);             // method 0 = store
      dv.setUint16(10, DOS_TIME, true);
      dv.setUint16(12, DOS_DATE, true);
      dv.setUint32(14, crc, true);
      dv.setUint32(18, size, true);
      dv.setUint32(22, size, true);
      dv.setUint16(26, nameBytes.length, true);
      dv.setUint16(28, 0, true);
      lh.set(nameBytes, 30);
      chunks.push(lh, f.data);
      central.push({ nameBytes, crc, size, offset });
      offset += lh.length + size;
    }
    const cdChunks = [];
    let cdSize = 0;
    for (const c of central) {
      const ch = new Uint8Array(46 + c.nameBytes.length);
      const dv = new DataView(ch.buffer);
      dv.setUint32(0, 0x02014b50, true);
      dv.setUint16(4, 20, true);
      dv.setUint16(6, 20, true);
      dv.setUint16(8, 0x0800, true);
      dv.setUint16(10, 0, true);
      dv.setUint16(12, DOS_TIME, true);
      dv.setUint16(14, DOS_DATE, true);
      dv.setUint32(16, c.crc, true);
      dv.setUint32(20, c.size, true);
      dv.setUint32(24, c.size, true);
      dv.setUint16(28, c.nameBytes.length, true);
      dv.setUint32(42, c.offset, true);
      ch.set(c.nameBytes, 46);
      cdChunks.push(ch);
      cdSize += ch.length;
    }
    const end = new Uint8Array(22);
    const edv = new DataView(end.buffer);
    edv.setUint32(0, 0x06054b50, true);
    edv.setUint16(8, central.length, true);
    edv.setUint16(10, central.length, true);
    edv.setUint32(12, cdSize, true);
    edv.setUint32(16, offset, true);
    const all = [...chunks, ...cdChunks, end];
    let total = 0; for (const a of all) total += a.length;
    const out = new Uint8Array(total);
    let p = 0; for (const a of all) { out.set(a, p); p += a.length; }
    return out;
  }

  // ------------------------------------------------------ regex parse helpers
  function firstAttr(scope, tag) {
    const m = scope.match(new RegExp("<" + tag + "(?:\\s[^>]*)?\\sValue=\"([^\"]*)\""));
    return m ? m[1] : null;
  }
  function firstText(scope, tag) {
    const m = scope.match(new RegExp("<" + tag + ">([\\s\\S]*?)</" + tag + ">"));
    return m ? m[1] : null;
  }
  function section(scope, tag) {
    const m = scope.match(new RegExp("<" + tag + ">([\\s\\S]*?)</" + tag + ">"));
    return m ? m[1] : null;
  }
  function xmlUnescape(s) {
    return String(s).replace(/&lt;/g, "<").replace(/&gt;/g, ">")
      .replace(/&quot;/g, '"').replace(/&apos;/g, "'").replace(/&amp;/g, "&");
  }

  // =================================================== REVERSE: .adg -> .xpm
  function parseAdg(xmlText, fallbackName) {
    const psMatch = xmlText.match(/<PadScrollPosition Value="(\d+)"/);
    const psp = psMatch ? parseInt(psMatch[1], 10) : 0;

    const branches = xmlText.match(/<DrumBranchPreset Id="\d+">[\s\S]*?<\/DrumBranchPreset>/g) || [];
    const raw = [];
    for (const br of branches) {
      const idM = br.match(/<DrumBranchPreset Id="(\d+)">/);
      const bid = idM ? parseInt(idM[1], 10) : 0;
      const zone = section(br, "ZoneSettings") || "";
      const recv = parseInt(firstAttr(zone, "ReceivingNote") || "0", 10);
      const choke = parseInt(firstAttr(zone, "ChokeGroup") || "0", 10);

      const partM = br.match(/<MultiSamplePart\b[^>]*>([\s\S]*?)<\/MultiSamplePart>/);
      if (!partM) continue;
      const part = partM[1];
      let name = firstAttr(part, "Name") || "";
      name = xmlUnescape(name).trim();
      const fileRef = section(part, "FileRef") || part;
      let rel = ""; let abs = "";
      const relM = fileRef.match(/<RelativePath Value="([^"]*)"/);
      const absM = fileRef.match(/<Path Value="([^"]*)"/);
      rel = relM ? xmlUnescape(relM[1]) : "";
      abs = absM ? xmlUnescape(absM[1]) : "";
      if (!name && rel) name = baseNoExt(rel);
      if (!name && !rel && !abs) continue;

      const sampleStart = Math.round(parseFloat(firstAttr(part, "SampleStart") || "0"));
      const sampleEnd = Math.round(parseFloat(firstAttr(part, "SampleEnd") || "0"));

      // Simpler VolumeAndPan -> głośność (dB) + pan
      const vp = section(br, "VolumeAndPan") || "";
      const volSec = section(vp, "Volume") || "";
      const panSec = section(vp, "Panorama") || "";
      const volumeDb = parseFloat(firstAttr(volSec, "Manual") || "-12");
      const pan = parseFloat(firstAttr(panSec, "Manual") || "0");

      raw.push({ bid, recv, name, rel, abs, choke, sampleStart, sampleEnd, volumeDb, pan });
    }
    if (!raw.length) throw new Error("Brak padów z samplami w .adg");

    // detekcja plików z forward-toola: recv ściśle malejące od 92 (odporne na luki)
    const byId = [...raw].sort((a, b) => a.bid - b.bid);
    const recvs = byId.map(r => r.recv);
    let isTool = recvs.length >= 2 && recvs[0] === 92;
    for (let i = 0; isTool && i < recvs.length - 1; i++)
      if (!(recvs[i] > recvs[i + 1])) isTool = false;

    const pads = raw.map(r => ({
      midi: isTool ? (128 - r.recv) : r.recv,
      sampleName: r.name, relPath: r.rel, absPath: r.abs, choke: r.choke,
      sampleStart: r.sampleStart, sampleEnd: r.sampleEnd,
      volumeDb: r.volumeDb, pan: r.pan,
    }));
    pads.sort((a, b) => a.midi - b.midi);
    return { programName: fallbackName, pads, isTool };
  }

  function defaultMapping(pads, compact) {
    let shift = 0;
    if (compact && pads.length) shift = Math.min(...pads.map(p => p.midi)) - 36;
    const map = new Map();
    pads.forEach((p, idx) => {
      const padNo = (p.midi - shift) - NOTE_OFFSET;
      if (padNo >= 1 && padNo <= MAX_PADS) map.set(padNo, idx);
    });
    return map;
  }

  const EMPTY_ASSIGN = {
    sampleName: "", muteGroup: 0, volume: MPC_DEFAULT_VOLUME, pan: MPC_DEFAULT_PAN,
    sampleStart: 0, sampleEnd: 0, sliceStart: 0, sliceEnd: 0, xfade: 0,
  };

  function renderInstrument(number, a) {
    let out = TEMPLATES.mpc3_instrument;
    out = out.replace("__INST_NUMBER__", String(number));
    out = out.replace("__MUTE_GROUP__", String(a.muteGroup));
    out = out.replace("__SAMPLE_NAME__", xmlEscape(a.sampleName));
    out = out.replace("__INST_VOLUME__", f6(a.volume));
    out = out.replace("__INST_PAN__", f6(a.pan));
    out = out.replace("__L_SAMPLE_START__", String(a.sampleStart));
    out = out.replace("__L_SAMPLE_END__", String(a.sampleEnd));
    out = out.replace("__L_SLICE_START__", String(a.sliceStart));
    out = out.replace("__SLICE_END__", String(a.sliceEnd));
    out = out.replace("__L_XFADE__", String(a.xfade));
    return out;
  }

  function buildXpm(programName, assignments) {
    let head = TEMPLATES.mpc3_head.replace("__PROGRAM_NAME__", xmlEscape(programName));
    const parts = [head];
    for (let n = 1; n <= MAX_PADS; n++) {
      const a = assignments.get(n) || EMPTY_ASSIGN;
      parts.push(renderInstrument(n, a));
    }
    parts.push(TEMPLATES.mpc3_tail);
    return parts.join("");
  }

  // sampleFiles: Map(lowerBaseNoExt -> {name, bytes:Uint8Array})
  function resolveSample(pad, sampleFiles) {
    const tryKeys = [];
    if (pad.relPath) tryKeys.push(baseNoExt(pad.relPath).toLowerCase());
    if (pad.sampleName) tryKeys.push(pad.sampleName.toLowerCase());
    for (const k of tryKeys) if (sampleFiles.has(k)) return sampleFiles.get(k);
    return null;
  }

  // adgBytes: Uint8Array; sampleFiles: Map; opts {compact, programName, mapping?}
  async function convertReverse(adgBytes, sampleFiles, opts) {
    opts = opts || {};
    const xml = new TextDecoder().decode(await gunzip(adgBytes));
    const programName = opts.programName || "Kit";
    const parsed = parseAdg(xml, programName);
    const mapping = opts.mapping || defaultMapping(parsed.pads, !!opts.compact);

    const assignments = new Map();
    const outFiles = new Map();   // name -> {name, data}
    const missing = [];
    for (const [padNo, idx] of mapping) {
      const pad = parsed.pads[idx];
      if (!pad) continue;
      const src = resolveSample(pad, sampleFiles);
      if (!src) { missing.push(pad.relPath || pad.sampleName || ("MIDI" + pad.midi)); continue; }
      if (!outFiles.has(src.name)) outFiles.set(src.name, { name: src.name, data: src.bytes });
      const frames = wavFrames(src.bytes.buffer.slice(src.bytes.byteOffset, src.bytes.byteOffset + src.bytes.byteLength));
      let start = Math.max(0, pad.sampleStart);
      let end = pad.sampleEnd > 0 ? pad.sampleEnd : frames;
      if (frames && end > frames) end = frames;
      const trimmed = start > 0 || (pad.sampleEnd > 0 && pad.sampleEnd < frames);
      let sliceStart, sliceEnd, sStart, sEnd;
      if (trimmed) { sliceStart = start; sliceEnd = Math.max(start, end - 1); sStart = start; sEnd = end; }
      else { sliceStart = 0; sliceEnd = Math.max(0, frames - 1); sStart = 0; sEnd = 0; }
      assignments.set(padNo, {
        sampleName: baseNoExt(src.name), muteGroup: pad.choke,
        volume: dbToMpcVolume(pad.volumeDb), pan: Math.min(Math.max(0.5 + pad.pan * 0.5, 0), 1),
        sampleStart: sStart, sampleEnd: sEnd, sliceStart, sliceEnd, xfade: -1,
      });
    }
    if (!assignments.size) throw new Error("Żaden sampel nie został dopasowany. Dodaj pliki WAV.");

    const xpm = buildXpm(programName, assignments);
    const zipFiles = [{ name: programName + "/" + programName + ".xpm", data: new TextEncoder().encode(xpm) }];
    for (const f of outFiles.values()) zipFiles.push({ name: programName + "/" + f.name, data: f.data });
    return {
      xpmText: xpm, zip: makeZip(zipFiles),
      placed: assignments.size, missing, pads: parsed.pads, mapping, isTool: parsed.isTool,
    };
  }

  // =================================================== FORWARD: .xpm -> .adg
  function parseXpm(xmlText, fallbackName) {
    const progName = (firstText(xmlText, "ProgramName") || fallbackName || "Kit").trim();
    // bierzemy blok Program type="Drum" jeśli jest
    let prog = xmlText;
    const pm = xmlText.match(/<Program type="Drum">([\s\S]*?)<\/Program>/);
    if (pm) prog = pm[1];
    const instrBlocks = prog.match(/<Instrument number="\d+">[\s\S]*?<\/Instrument>/g) || [];
    const padMap = new Map();   // instNum -> sampleName
    const muteMap = new Map();  // instNum -> muteGroup
    for (const ib of instrBlocks) {
      const numM = ib.match(/<Instrument number="(\d+)">/);
      const num = numM ? parseInt(numM[1], 10) : 0;
      if (num <= 0) continue;
      // pierwsza niepusta SampleName (warstwa)
      const names = ib.match(/<SampleName>([^<]*)<\/SampleName>/g) || [];
      let sample = "";
      for (const n of names) {
        const v = n.replace(/<\/?SampleName>/g, "").trim();
        if (v) { sample = xmlUnescape(v); break; }
      }
      if (!sample) continue;
      padMap.set(num, sample);
      const mg = ib.match(/<MuteGroup>(\d+)<\/MuteGroup>/);
      if (mg) muteMap.set(num, parseInt(mg[1], 10));
    }
    if (!padMap.size) throw new Error("Brak instrumentów z samplami w .xpm");
    return { programName: progName, padMap, muteMap };
  }

  function pathHintXml(relParts) {
    // relParts = katalogi w ścieżce (zwykle puste w web)
    return relParts.map((d, i) => '<RelativePathElement Id="' + (i + 8) + '" Dir="' + xmlEscape(d) + '" />').join("\n");
  }
  function renderPad(padId, padNote, sampleFileName, fileSize, choke) {
    let out = TEMPLATES.adg_pad;
    const stem = baseNoExt(sampleFileName);
    out = out.replace(/<%- PadNumber %>/g, String(padId));
    out = out.replace(/<%- SampleNameWithoutWav %>/g, xmlEscape(stem));
    out = out.replace(/<%- SampleName %>/g, xmlEscape(sampleFileName));
    out = out.replace(/<%= PadNote %>/g, String(padNote));
    out = out.replace(/<%= ChokeGroup %>/g, String(choke || 0));
    out = out.replace(/__SAMPLE_ABS_PATH__/g, xmlEscape(sampleFileName));
    out = out.replace(/<PathHint>[\s\S]*?<\/PathHint>/, "<PathHint>\n\n</PathHint>");
    out = out.replace(/<FileSize Value="\d+" \/>/, '<FileSize Value="' + (fileSize || 0) + '" />');
    out = out.replace(/<Crc Value="\d+" \/>/, '<Crc Value="0" />');
    out = out.replace(/<HasExtendedInfo Value="true" \/>/, '<HasExtendedInfo Value="false" />');
    return out;
  }

  // padPaths: Map(instNum -> {fileName, size}); muteMap; firstNote
  function buildAdgXml(padPaths, muteMap, firstNote) {
    const FACTORY = 92;
    const nums = [...padPaths.keys()].sort((a, b) => a - b);
    let truncated = 0;
    const valid = [];
    for (const n of nums) {
      const note = firstNote + n - 1;
      if (note > 127 || note < 0) { truncated++; continue; }
      valid.push([note, n]);
    }
    const firstVisible = valid.length ? valid[0][0] : 36;
    const padsXml = [];
    valid.forEach(([targetMidi, instNum], idx) => {
      const sp = padPaths.get(instNum);
      const recv = FACTORY - idx;
      const choke = muteMap.get(instNum) || 0;
      padsXml.push(renderPad(idx, recv, sp.fileName, sp.size, choke));
    });
    const padScroll = Math.max(0, Math.floor(firstVisible / 4));
    const head = TEMPLATES.adg_head.replace("__PAD_SCROLL_POSITION__", String(padScroll));
    return { xml: head + "\n" + padsXml.join("\n") + "\n" + TEMPLATES.adg_tail, truncated };
  }

  function autoFirstNote(maxInst) {
    const maxFirst = 127 - maxInst + 1;
    if (maxFirst < 0) return 0;
    return Math.min(36, maxFirst);
  }

  // xpmBytes: Uint8Array; sampleFiles: Map; opts {firstNote, programName}
  async function convertForward(xpmBytes, sampleFiles, opts) {
    opts = opts || {};
    const xml = new TextDecoder().decode(xpmBytes);
    const parsed = parseXpm(xml, opts.programName);
    const padPaths = new Map();
    const outFiles = new Map();
    const missing = [];
    for (const [instNum, sampleName] of parsed.padMap) {
      const key = sampleName.toLowerCase();
      const src = sampleFiles.get(key) || sampleFiles.get(baseNoExt(sampleName).toLowerCase());
      if (!src) { missing.push(sampleName); continue; }
      if (!outFiles.has(src.name)) outFiles.set(src.name, { name: src.name, data: src.bytes });
      padPaths.set(instNum, { fileName: src.name, size: src.bytes.length });
    }
    if (!padPaths.size) throw new Error("Żaden sampel nie został dopasowany. Dodaj pliki WAV.");
    const maxInst = Math.max(...padPaths.keys());
    const fn = (opts.firstNote != null) ? opts.firstNote : autoFirstNote(maxInst);
    const { xml: adgXml, truncated } = buildAdgXml(padPaths, parsed.muteMap, fn);
    const adgGz = await gzip(new TextEncoder().encode(adgXml));
    const name = parsed.programName;
    const zipFiles = [{ name: name + "/" + name + ".adg", data: adgGz }];
    for (const f of outFiles.values()) zipFiles.push({ name: name + "/" + f.name, data: f.data });
    return {
      adg: adgGz, zip: makeZip(zipFiles), programName: name,
      placed: padPaths.size, missing, truncated, firstNote: fn,
    };
  }

  // ----------------------------------------------------------------- export
  const API = {
    gunzip, gzip, wavFrames, makeZip, crc32,
    parseAdg, defaultMapping, buildXpm, convertReverse,
    parseXpm, buildAdgXml, convertForward,
    dbToMpcVolume, mpcVolumeToDb, baseNoExt,
  };
  G.MPCWEB = API;
  if (typeof module !== "undefined" && module.exports) module.exports = API;
})(typeof window !== "undefined" ? window : globalThis);
