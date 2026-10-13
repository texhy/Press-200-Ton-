"use client";

/** Operator-facing strings only. Shop-floor Urdu, not literary — this wants a
 *  native check from someone who actually works the press before it ships. */
export const STRINGS = {
  en: {
    dir: "ltr", urdu: false,
    title: "My shift", machine: "Machine", operator: "Operator",
    todaysJob: "Today's job", part: "Part", process: "Process", die: "Die",
    target: "Parts required today", made: "Made so far", remaining: "Still to make",
    progress: "Progress", onTrack: "On track", behind: "Behind target",
    pace: "Speed now", perMin: "per minute", targetPace: "should be",
    status: "Right now", working: "Working", idle: "At machine, not working", away: "Away",
    material: "Steel sheets", present: "Available", none: "None — call forklift",
    doNow: "What to do now",
    allGood: "Nothing to do — keep going",
    myTime: "My time", machineWaiting: "Waiting on the machine",
    waitingNote: "This time was not yours to lose",
    notExplained: "Not yet explained",
    notExplainedNote: "Nobody has worked out why yet",
    myDay: "My day", strokes: "Strokes",
    noCamera: "Camera not covering this time",
    note: "Times come from the machine controller. The camera shows whether you were at the station.",
    lang: "اردو",
  },
  ur: {
    dir: "rtl", urdu: true,
    title: "میری شفٹ", machine: "مشین", operator: "آپریٹر",
    todaysJob: "آج کا کام", part: "پرزہ", process: "عمل", die: "ڈائی",
    target: "آج کتنے پرزے بنانے ہیں", made: "اب تک بنائے", remaining: "باقی بنانے ہیں",
    progress: "پیش رفت", onTrack: "ٹھیک چل رہا ہے", behind: "ہدف سے پیچھے",
    pace: "موجودہ رفتار", perMin: "فی منٹ", targetPace: "ہونی چاہیے",
    status: "اس وقت", working: "کام جاری ہے", idle: "مشین پر ہیں، کام نہیں", away: "غیر حاضر",
    material: "اسٹیل شیٹس", present: "موجود ہیں", none: "ختم — فورک لفٹ بلائیں",
    doNow: "اب کیا کرنا ہے",
    allGood: "کچھ نہیں — کام جاری رکھیں",
    myTime: "میرا وقت", machineWaiting: "مشین کا انتظار",
    waitingNote: "یہ وقت آپ کی غلطی سے ضائع نہیں ہوا",
    notExplained: "ابھی وجہ معلوم نہیں",
    notExplainedNote: "کسی نے ابھی تک وجہ نہیں بتائی",
    myDay: "میرا دن", strokes: "اسٹروک",
    noCamera: "اس وقت کیمرہ موجود نہیں",
    note: "اوقات مشین کنٹرولر سے لیے گئے ہیں۔ کیمرہ بتاتا ہے کہ آپ اسٹیشن پر تھے یا نہیں۔",
    lang: "English",
  },
} as const;

export type Lang = keyof typeof STRINGS;

/** Causes the operator could not have prevented — shown separately from their
 *  own time. If the view blames a worker for minutes the PLANT lost, they stop
 *  trusting it and start gaming it. */
export const MACHINE_CAUSED = new Set([
  "feed_jam", "lubrication", "air", "overload", "drive_trip",
  "breakdown", "material", "changeover", "die_tryout", "idle_burn",
]);
