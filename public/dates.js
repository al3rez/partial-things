(function (root, factory) {
    const api = factory();
    if (typeof module === "object" && module.exports) module.exports = api;
    root.ThingsDates = api;
})(typeof globalThis !== "undefined" ? globalThis : this, function () {
    const WEEKDAYS = ["sunday", "monday", "tuesday", "wednesday", "thursday", "friday", "saturday"];
    const MONTHS = ["january", "february", "march", "april", "may", "june", "july", "august", "september", "october", "november", "december"];
    const NUM = { a: 1, an: 1, one: 1, two: 2, three: 3, four: 4, five: 5, six: 6, seven: 7, eight: 8, nine: 9, ten: 10, eleven: 11, twelve: 12 };

    function iso(d) {
        const z = (n) => String(n).padStart(2, "0");
        return d.getFullYear() + "-" + z(d.getMonth() + 1) + "-" + z(d.getDate());
    }
    function parseISO(s) {
        const [y, m, da] = s.split("-").map(Number);
        return new Date(y, m - 1, da);
    }
    function addDays(date, n) {
        const d = new Date(date.getFullYear(), date.getMonth(), date.getDate());
        d.setDate(d.getDate() + n);
        return d;
    }
    function startOfToday(now) {
        return new Date(now.getFullYear(), now.getMonth(), now.getDate());
    }
    function weekdayIndex(token) {
        const hit = WEEKDAYS.find((day) => day.startsWith(token) && token.length >= 3);
        if (hit) return WEEKDAYS.indexOf(hit);
        const short = { sun: 0, mon: 1, tue: 2, tues: 2, wed: 3, thu: 4, thur: 4, thurs: 4, fri: 5, sat: 6 };
        return short[token] ?? null;
    }
    function monthIndex(token) {
        if (token.length < 3) return null;
        const hit = MONTHS.find((month) => month.startsWith(token));
        return hit ? MONTHS.indexOf(hit) : null;
    }
    function numberWord(token) {
        if (/^\d+$/.test(token)) return Number(token);
        return NUM[token] ?? null;
    }
    function nextWeekday(today, index, forceNext) {
        const delta = (index - today.getDay() + 7) % 7;
        const days = forceNext ? (delta === 0 ? 7 : delta + 7) : delta;
        return addDays(today, days);
    }

    function extractTime(input) {
        const match = input.match(/\b(?:at\s+)?(\d{1,2})(?::(\d{2}))?\s*(am|pm)\b|\b(\d{1,2}):(\d{2})\b/i);
        if (!match) return { text: input, time: null };
        let hour = Number(match[1] || match[4]);
        let minute = Number(match[2] || match[5] || 0);
        const ampm = (match[3] || "").toLowerCase();
        if (ampm === "pm" && hour < 12) hour += 12;
        if (ampm === "am" && hour === 12) hour = 0;
        if (!ampm && (hour > 23 || minute > 59)) return { text: input, time: null };
        if (ampm && (hour > 23 || minute > 59)) return { text: input, time: null };
        const hh = String(hour).padStart(2, "0");
        const mm = String(minute).padStart(2, "0");
        return { text: input.replace(match[0], " ").replace(/\s+/g, " ").trim(), time: hh + ":" + mm };
    }

    function parseNatural(input, now) {
        now = now || new Date();
        const today = startOfToday(now);
        let text = String(input || "").trim().toLowerCase().replace(/[.,!]/g, "");
        if (!text) return null;
        if (["clear", "none", "no date", "anytime"].includes(text)) {
            return { when_date: null, evening: false, someday: false, reminder: null, deadline: null, clear: true };
        }
        let deadline = false;
        if (text.startsWith("deadline ")) {
            deadline = true;
            text = text.slice(9).trim();
        }
        const timed = extractTime(text);
        text = timed.text;
        const time = timed.time;
        let when = null;
        let evening = false;
        let someday = false;

        if (!text) {
            when = today;
            if (time) {
                const [hh, mm] = time.split(":").map(Number);
                const candidate = new Date(today.getFullYear(), today.getMonth(), today.getDate(), hh, mm);
                if (candidate <= now) when = addDays(today, 1);
            }
        } else if (["today", "tod"].includes(text)) when = today;
        else if (["tonight", "evening", "this evening", "eve"].includes(text)) {
            when = today;
            evening = true;
        } else if (["tomorrow", "tom", "tmr", "tmrw"].includes(text)) when = addDays(today, 1);
        else if (text === "someday" || text === "some day") someday = true;
        else if (text === "next week") when = addDays(today, 7);
        else {
            let forceNext = false;
            let rest = text;
            if (rest.startsWith("next ")) {
                forceNext = true;
                rest = rest.slice(5).trim();
            }
            const inMatch = rest.match(/^in\s+([a-z0-9]+)\s+(day|days|week|weeks|month|months)$/);
            if (inMatch) {
                const n = numberWord(inMatch[1]);
                if (!n) return null;
                const unit = inMatch[2].startsWith("day") ? 1 : inMatch[2].startsWith("week") ? 7 : 30;
                when = addDays(today, n * unit);
            } else {
                const wd = weekdayIndex(rest);
                if (wd !== null) when = nextWeekday(today, wd, forceNext);
                else {
                    const md = rest.match(/^([a-z]+)\s+(\d{1,2})(?:\s+(\d{4}))?$/);
                    if (md) {
                        const month = monthIndex(md[1]);
                        const day = Number(md[2]);
                        if (month === null || day < 1 || day > 31) return null;
                        let year = md[3] ? Number(md[3]) : today.getFullYear();
                        let date = new Date(year, month, day);
                        if (date.getMonth() !== month) return null;
                        if (!md[3] && date < today) {
                            year += 1;
                            date = new Date(year, month, day);
                        }
                        when = date;
                    } else if (/^\d{4}-\d{2}-\d{2}$/.test(rest)) when = parseISO(rest);
                    else return null;
                }
            }
        }
        if (someday) {
            return { when_date: null, evening: false, someday: true, reminder: null, deadline: null, clear: false };
        }
        const whenISO = when ? iso(when) : null;
        if (deadline) {
            return { when_date: null, evening: false, someday: false, reminder: null, deadline: whenISO, clear: false };
        }
        return {
            when_date: whenISO,
            evening: evening && !time,
            someday: false,
            reminder: time,
            deadline: null,
            clear: false
        };
    }

    return { parseNatural, iso, addDays, parseISO };
});
