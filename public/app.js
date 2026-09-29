const CHECK = '<svg viewBox="0 0 16 16" aria-hidden="true"><path d="M3.2 8.2 6.3 11.2 12.8 4.8" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"/></svg>';
const $ = (sel, root = document) => root.querySelector(sel);
const $$ = (sel, root = document) => [...root.querySelectorAll(sel)];

let state = null;
let ui = {
    view: "today",
    selected: [],
    openId: null,
    quick: null,
    jump: null,
    dialog: null,
    dragging: null,
    slim: localStorage.getItem("things-slim") === "1",
    theme: localStorage.getItem("things-theme") || "light",
    showArchived: false,
    paperSnap: false,
    plusDragged: false
};
let saveTimer = 0;
const reminded = new Set();

function esc(s) {
    return String(s ?? "").replace(/[&<>"']/g, (ch) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[ch]));
}
function icon(name) {
    const paths = {
        inbox: '<path d="M4 8h16l-1.4 9.2H5.4L4 8z" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linejoin="round"/><path d="M8 8V6.2A2.2 2.2 0 0 1 10.2 4h3.6A2.2 2.2 0 0 1 16 6.2V8" fill="none" stroke="currentColor" stroke-width="1.7"/>',
        star: '<path fill="currentColor" d="M12 3.2 14.1 8l5 .6-3.8 3.3 1 4.9L12 14.2 7.7 16.8l1-4.9L4.9 8.6 10 8z"/>',
        cal: '<rect x="4" y="5" width="16" height="14" rx="2" fill="none" stroke="currentColor" stroke-width="1.7"/><path d="M8 3.5v4M16 3.5v4M4 9.5h16" stroke="currentColor" stroke-width="1.7" fill="none"/>',
        layers: '<path d="M12 4 20 8.2 12 12.4 4 8.2zM6.2 12.2 12 15.2l5.8-3M6.2 15.4 12 18.4l5.8-3" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linejoin="round"/>',
        box: '<path d="M4 8.2 12 4.5l8 3.7V19H4zM4 8.2l8 3.6 8-3.6M12 11.8V19" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linejoin="round"/>',
        book: '<path d="M6 4.5h12v15H6a2 2 0 0 1-2-2v-11a2 2 0 0 1 2-2z" fill="none" stroke="currentColor" stroke-width="1.7"/><path d="M6 4.5v15" stroke="currentColor" stroke-width="1.7"/>',
        trash: '<path d="M5 7h14M9 7V5h6v2M7.2 7l.8 12h8l.8-12" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linejoin="round"/>'
    };
    return `<svg class="ico ${name}" viewBox="0 0 24 24" aria-hidden="true">${paths[name] || ""}</svg>`;
}
function pie(ratio) {
    const r = 5.5;
    const c = 2 * Math.PI * r;
    const dash = Math.max(0, Math.min(1, ratio)) * c;
    return `<svg class="pie" viewBox="0 0 16 16" aria-hidden="true"><circle cx="8" cy="8" r="${r}" fill="none" stroke="#d0d0d5" stroke-width="2"></circle><circle cx="8" cy="8" r="${r}" fill="none" stroke="#4c7dff" stroke-width="2" stroke-linecap="round" stroke-dasharray="${dash} ${c}" transform="rotate(-90 8 8)"></circle></svg>`;
}
function todo(id) { return state.todos.find((item) => item.id === id); }
function projectById(id) { return state.projects.find((item) => item.id === id); }
function headingById(id) { return state.headings.find((item) => item.id === id); }
function tagById(id) { return state.tags.find((item) => item.id === id); }
function calendarById(id) { return state.calendars.find((item) => item.id === id); }
function parseDay(iso) {
    const [y, m, d] = iso.split("-").map(Number);
    return new Date(y, m - 1, d);
}
function isoFromDate(d) { return ThingsDates.iso(d); }
function addDaysISO(isoDate, n) { return isoFromDate(ThingsDates.addDays(parseDay(isoDate), n)); }
function serverNow() {
    const [day, time] = state.now.split(" ");
    const [y, m, d] = day.split("-").map(Number);
    const [hh, mm, ss] = (time || "00:00:00").split(":").map(Number);
    return new Date(y, m - 1, d, hh || 0, mm || 0, ss || 0);
}
function formatLong(isoDate) {
    return parseDay(isoDate).toLocaleDateString(undefined, { weekday: "long", month: "long", day: "numeric" });
}
function formatShort(isoDate) {
    if (!isoDate) return "";
    if (isoDate === state.today) return "Today";
    if (isoDate === addDaysISO(state.today, 1)) return "Tomorrow";
    if (isoDate === addDaysISO(state.today, -1)) return "Yesterday";
    return parseDay(isoDate).toLocaleDateString(undefined, { weekday: "short", month: "short", day: "numeric" });
}
function formatWhen(item) {
    if (item.someday) return "Someday";
    if (!item.when_date) return "";
    if (item.when_date === state.today && item.evening) return "This Evening";
    return formatShort(item.when_date);
}
function archived(item) {
    const project = projectById(item.project_id);
    if (project && project.archived) return true;
    const heading = headingById(item.heading_id);
    return !!(heading && heading.archived);
}
function alive(item) { return item && !item.completed_at && !item.trashed_at && !archived(item); }
function byPos(a, b) { return a.position - b.position || String(a.created_at).localeCompare(String(b.created_at)); }
function hashView() {
    const raw = decodeURIComponent((location.hash || "#today").slice(1));
    if (!raw) return "today";
    if (raw.startsWith("project/")) return "project:" + raw.slice(8);
    if (raw.startsWith("area/")) return "area:" + raw.slice(5);
    if (raw.startsWith("tag/")) return "tag:" + raw.slice(4);
    return raw;
}
function viewHash(view) {
    if (view.startsWith("project:")) return "#project/" + view.slice(8);
    if (view.startsWith("area:")) return "#area/" + view.slice(5);
    if (view.startsWith("tag:")) return "#tag/" + view.slice(4);
    return "#" + view;
}
function knownView(view) {
    if (["inbox", "today", "upcoming", "anytime", "someday", "logbook", "trash"].includes(view)) return true;
    if (view.startsWith("project:")) return !!projectById(view.slice(8));
    if (view.startsWith("area:")) return state.areas.some((area) => area.id === view.slice(5));
    if (view.startsWith("tag:")) return !!tagById(view.slice(4));
    return false;
}

async function load() {
    const res = await fetch("api.php?action=state");
    const data = await res.json();
    if (!data.ok) throw new Error(data.error || "Could not load");
    state = data.state;
}
async function mutate(action, body = {}, opts = {}) {
    const res = await fetch("api.php", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(Object.assign({ action }, body))
    });
    const data = await res.json();
    if (!data.ok) {
        toast(data.error || "Something went wrong");
        throw new Error(data.error || "Request failed");
    }
    state = data.state;
    if (!knownView(ui.view)) ui.view = "today";
    if (ui.openId && !todo(ui.openId)) ui.openId = null;
    if (opts.quiet) renderChrome();
    else render();
    return data;
}

function navigate(view, opts = {}) {
    if (!knownView(view)) view = "today";
    ui.view = view;
    ui.selected = [];
    if (!opts.keepOpen) ui.openId = null;
    ui.jump = null;
    if (!opts.fromHash && location.hash !== viewHash(view)) history.pushState({ view }, "", viewHash(view));
    render();
}

function countFor(view) {
    if (view === "inbox") return state.todos.filter((item) => alive(item) && !item.project_id && !item.someday).length;
    if (view === "today") return todayTodos().length;
    if (view === "upcoming") return state.todos.filter((item) => alive(item) && !item.someday && item.when_date && item.when_date > state.today).length;
    if (view === "anytime") return state.todos.filter((item) => alive(item) && item.project_id && !item.when_date && !item.someday).length;
    if (view === "someday") return state.todos.filter((item) => alive(item) && item.someday).length;
    if (view.startsWith("project:")) return state.todos.filter((item) => alive(item) && item.project_id === view.slice(8)).length;
    return 0;
}
function progress(projectId) {
    const items = state.todos.filter((item) => item.project_id === projectId && !item.trashed_at && !archived(item));
    if (!items.length) return 0;
    return items.filter((item) => item.completed_at).length / items.length;
}
function todayTodos() {
    return state.todos.filter((item) => alive(item) && !item.someday && item.when_date && item.when_date <= state.today).sort(byPos);
}
function visibleEvents(date) {
    return state.events.filter((event) => event.date === date && calendarById(event.calendar_id)?.visible);
}

function render() {
    document.body.classList.toggle("slim", ui.slim);
    document.body.dataset.theme = ui.theme;
    renderChrome();
    renderPaper();
    renderJump();
    renderQuick();
    renderDialog();
    renderBatch();
}
function renderChrome() {
    renderSidebar();
    renderTop();
    renderStage();
}
function renderSidebar() {
    const views = [["inbox", "Inbox", "package"], ["today", "Today", "star"], ["upcoming", "Upcoming", "calendar"], ["anytime", "Anytime", "books"], ["someday", "Someday", "file-folder"], ["logbook", "Logbook", "green-book"], ["trash", "Trash", "wastebasket"]];
    const item = (view, label, name) => {
        const n = countFor(view);
        const active = ui.view === view ? " active" : "";
        return `<button class="nav-item${active}" data-view="${esc(view)}" type="button">${AppleEmojis.img(name, 18)}<span class="nav-label">${esc(label)}</span>${n ? `<span class="badge">${n}</span>` : ""}</button>`;
    };
    const areas = state.areas.map((area) => {
        const projects = state.projects.filter((project) => project.area_id === area.id && !project.archived).sort(byPos);
        return `<div class="area-label" data-view="area:${esc(area.id)}" role="button" tabindex="0">${emojiButton("area", area.id, area.emoji || "file-folder", 14)}<span class="nav-label">${esc(area.title)}</span></div>` + projects.map(projectButton).join("");
    }).join("");
    const loose = state.projects.filter((project) => !project.area_id && !project.archived).sort(byPos).map(projectButton).join("");
    const archivedProjects = state.projects.filter((project) => project.archived);
    const archivedHtml = archivedProjects.length ? `<button class="side-btn" data-action="toggle-archived" type="button">${ui.showArchived ? "Hide" : "Show"} archived</button>` + (ui.showArchived ? archivedProjects.map(projectButton).join("") : "") : "";
    const tags = state.tags.length ? `<div class="side-gap"></div><div class="area-label">Tags</div>` + state.tags.map((tag) => item("tag:" + tag.id, tag.title, "label")).join("") : "";
    $("#sidebar").innerHTML = views.slice(0, 5).map((row) => item(row[0], row[1], row[2])).join("")
        + `<div class="side-gap"></div>` + item("logbook", "Logbook", "green-book") + item("trash", "Trash", "wastebasket")
        + `<div class="side-gap"></div>` + areas + loose + tags
        + `<div class="side-footer"><button data-action="new-project" type="button">New Project</button><button data-action="new-area" type="button">New Area</button><button data-action="theme" type="button">${ui.theme === "dark" ? "Light" : "Dark"}</button><button data-action="reset" type="button">Reset sample</button></div>` + archivedHtml;
}
function projectButton(project) {
    const active = ui.view === "project:" + project.id ? " active" : "";
    const mark = project.emoji ? emojiButton("project", project.id, project.emoji, 18) : pie(progress(project.id));
    return `<div class="nav-item project-row${active}" data-view="project:${esc(project.id)}" role="button" tabindex="0" draggable="true" data-drag="project:${esc(project.id)}">${mark}<span class="nav-label">${esc(project.title)}</span>${countFor("project:" + project.id) ? `<span class="badge">${countFor("project:" + project.id)}</span>` : ""}</div>`;
}
function renderTop() {
    const heading = headingModel();
    document.title = heading.title + " · Things";
    const mark = heading.emoji ? AppleEmojis.img(heading.emoji, 30) : "";
    const title = heading.editable
        ? `<div class="title-line">${mark}<input class="page-title" data-action="rename-view" value="${esc(heading.title)}" aria-label="Title"></div>`
        : `<button class="title-btn" data-action="title-menu" type="button"><div class="page-title title-line">${mark}<span>${esc(heading.title)}</span></div></button>`;
    $("#topbar").innerHTML = `<div>${title}<div class="page-sub">${esc(heading.sub)}</div></div><div class="toolbar"><button class="sidebar-toggle" data-action="slim" type="button" title="${ui.slim ? "Show sidebar" : "Hide sidebar"}" aria-label="${ui.slim ? "Show sidebar" : "Hide sidebar"}"><svg viewBox="0 0 24 24" aria-hidden="true"><rect x="3.5" y="4.5" width="17" height="15" rx="2" fill="none" stroke="currentColor" stroke-width="1.7"/><path d="M9 4.5v15" stroke="currentColor" stroke-width="1.7"/></svg></button><button class="plus" id="magic-plus" draggable="true" type="button" title="New To-Do. Drag it where it should go." aria-label="New To-Do"><svg viewBox="0 0 16 16" aria-hidden="true"><path d="M8 3.15v9.7M3.15 8h9.7" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round"/></svg></button></div>`;
    const plus = $("#magic-plus");
    plus.addEventListener("dragstart", (e) => {
        ui.plusDragged = true;
        ui.dragging = "magic";
        e.dataTransfer.setData("text/plain", "magic");
        e.dataTransfer.effectAllowed = "copy";
        document.body.classList.add("dragging-plus");
        $("#inbox-drop").hidden = false;
    });
    plus.addEventListener("dragend", () => {
        document.body.classList.remove("dragging-plus");
        $("#inbox-drop").hidden = true;
        setTimeout(() => { ui.plusDragged = false; ui.dragging = null; }, 0);
    });
    plus.addEventListener("click", () => {
        if (ui.plusDragged) return;
        createTodo(contextPatch());
    });
}
function headingModel() {
    const map = {
        inbox: ["Inbox", "Not in a project yet", "package"],
        today: ["Today", formatLong(state.today), "star"],
        upcoming: ["Upcoming", "The days ahead", "calendar"],
        anytime: ["Anytime", "In a project, with no date", "books"],
        someday: ["Someday", "Not ready to schedule", "file-folder"],
        logbook: ["Logbook", "Completed", "green-book"],
        trash: ["Trash", "Deleted to-dos", "wastebasket"]
    };
    if (map[ui.view]) return { title: map[ui.view][0], sub: map[ui.view][1], emoji: map[ui.view][2], editable: false };
    if (ui.view.startsWith("project:")) {
        const project = projectById(ui.view.slice(8));
        return { title: project ? project.title : "Project", sub: areaName(project?.area_id) || "Project", emoji: project?.emoji || "file-folder", editable: true };
    }
    if (ui.view.startsWith("area:")) {
        const area = state.areas.find((item) => item.id === ui.view.slice(5));
        return { title: area ? area.title : "Area", sub: "Area", emoji: area?.emoji || "file-folder", editable: true };
    }
    if (ui.view.startsWith("tag:")) {
        const tag = tagById(ui.view.slice(4));
        return { title: tag ? tag.title : "Tag", sub: "Tagged to-dos", emoji: "label", editable: false };
    }
    return { title: "Today", sub: formatLong(state.today), emoji: "star", editable: false };
}
function areaName(id) {
    return state.areas.find((area) => area.id === id)?.title || "";
}
function renderStage() {
    const html = [];
    if (ui.view === "today") html.push(todayHTML());
    else if (ui.view === "upcoming") html.push(upcomingHTML());
    else if (ui.view === "logbook") html.push(grouped(logbookGroups()));
    else if (ui.view === "trash") html.push(rowsOrEmpty(state.todos.filter((item) => item.trashed_at).sort((a, b) => String(b.trashed_at).localeCompare(String(a.trashed_at))), "Trash is empty", "Deleted to-dos wait here.") + (state.todos.some((item) => item.trashed_at) ? `<button class="text-btn danger" data-action="empty-trash" type="button">Empty Trash</button>` : ""));
    else if (ui.view.startsWith("project:")) html.push(projectHTML(ui.view.slice(8)));
    else if (ui.view.startsWith("area:")) html.push(areaHTML(ui.view.slice(5)));
    else if (ui.view.startsWith("tag:")) html.push(rowsOrEmpty(state.todos.filter((item) => alive(item) && item.tag_ids.includes(ui.view.slice(4))).sort(byPos), "Nothing tagged", "Add this tag from a to-do."));
    else html.push(rowsOrEmpty(listFor(ui.view), emptyCopy(ui.view)[0], emptyCopy(ui.view)[1], contextPatch()));
    html.push(`<div class="kbd">Drag + to insert · type to Quick Find · hover a circle for When · ⌘/Ctrl+Z undo</div>`);
    $("#stage").innerHTML = html.join("");
    if (ui.view === "today" || ui.view === "upcoming") $("#inbox-drop").dataset.patch = JSON.stringify({ project_id: "", heading_id: "", someday: 0 });
}
function listFor(view) {
    if (view === "inbox") return state.todos.filter((item) => alive(item) && !item.project_id && !item.someday).sort(byPos);
    if (view === "anytime") return state.todos.filter((item) => alive(item) && item.project_id && !item.when_date && !item.someday).sort(byPos);
    if (view === "someday") return state.todos.filter((item) => alive(item) && item.someday).sort(byPos);
    return [];
}
function emptyCopy(view) {
    return {
        inbox: ["Inbox zero", "New to-dos with no project land here."],
        today: ["Nothing for today", "Enjoy the quiet, or drag + into the day."],
        anytime: ["Anytime is clear", "Project to-dos without a date show up here."],
        someday: ["Someday is empty", "Park ideas here until they are ready."]
    }[view] || ["Nothing here", "Add a to-do with the plus button."];
}
function todayHTML() {
    const items = todayTodos();
    const overdue = items.filter((item) => item.when_date < state.today);
    const day = items.filter((item) => item.when_date === state.today && !item.evening);
    const evening = items.filter((item) => item.when_date === state.today && item.evening);
    const shown = new Set(items.map((item) => item.id));
    const deadlines = state.todos.filter((item) => alive(item) && !item.someday && item.deadline && item.deadline <= state.today && !shown.has(item.id)).sort(byPos);
    const events = visibleEvents(state.today);
    const parts = [calendarBlock(events, state.today)];
    if (overdue.length) parts.push(bucket("Overdue", overdue, { when_date: state.today, evening: 0, someday: 0 }, "late"));
    parts.push(bucket(day.length && (overdue.length || evening.length || deadlines.length) ? "Today" : "", day, { when_date: state.today, evening: 0, someday: 0 }));
    if (deadlines.length) parts.push(bucket("Deadlines", deadlines, { deadline: state.today }));
    parts.push(`<div class="evening-drop group-label" data-patch='${JSON.stringify({ when_date: state.today, evening: 1, someday: 0 })}'>This Evening</div>`);
    if (evening.length) parts.push(bucket("", evening, { when_date: state.today, evening: 1, someday: 0 }));
    if (!items.length && !deadlines.length && !events.length) parts.push(`<div class="empty"><strong>Nothing for today</strong>The evening list is there when you need it.</div>`);
    return parts.join("");
}
function upcomingHTML() {
    const days = [];
    for (let i = 1; i <= 14; i++) days.push(addDaysISO(state.today, i));
    state.todos.forEach((item) => {
        if (!alive(item)) return;
        [item.when_date, item.deadline].forEach((day) => { if (day && day > state.today && !days.includes(day)) days.push(day); });
    });
    state.events.forEach((event) => { if (event.date > state.today && !days.includes(event.date)) days.push(event.date); });
    days.sort();
    const visible = days.filter((day) => day <= addDaysISO(state.today, 7) || itemsOn(day).length || visibleEvents(day).length);
    if (!visible.length) return `<div class="empty"><strong>Nothing upcoming</strong>Schedule a to-do and it will land here.</div>`;
    return visible.map((day) => {
        const patch = { when_date: day, evening: 0, someday: 0 };
        const events = calendarBlock(visibleEvents(day), day);
        const rows = itemsOn(day);
        return `<div class="day" data-patch='${JSON.stringify(patch)}'><div class="day-label">${esc(formatShort(day))}</div>${events}${rows.map((item) => rowHTML(item)).join("") || `<div class="meta">Nothing scheduled</div>`}</div>`;
    }).join("");
}
function itemsOn(day) {
    return state.todos.filter((item) => alive(item) && !item.someday && (item.when_date === day || (item.deadline === day && item.when_date !== day))).sort(byPos);
}
function logbookGroups() {
    const map = new Map();
    state.todos.filter((item) => item.completed_at && !item.trashed_at).sort((a, b) => String(b.completed_at).localeCompare(String(a.completed_at))).forEach((item) => {
        const day = item.completed_at.slice(0, 10);
        if (!map.has(day)) map.set(day, []);
        map.get(day).push(item);
    });
    return [...map.entries()].map(([day, items]) => ({ label: formatShort(day), items }));
}
function grouped(groups) {
    if (!groups.length) return `<div class="empty"><strong>No completed to-dos</strong>Check something off and it lands here.</div>`;
    return groups.map((group) => `<div class="group-label">${esc(group.label)}</div>${group.items.map((item) => rowHTML(item)).join("")}`).join("");
}
function projectHTML(id) {
    const project = projectById(id);
    if (!project) return "";
    const headings = state.headings.filter((heading) => heading.project_id === id).sort(byPos);
    const openHeadings = headings.filter((heading) => !heading.archived);
    const archivedHeadings = headings.filter((heading) => heading.archived);
    const todos = state.todos.filter((item) => item.project_id === id && !item.completed_at && !item.trashed_at);
    const parts = [`<textarea class="project-notes" data-action="project-notes" placeholder="Notes">${esc(project.notes || "")}</textarea>`];
    parts.push(bucket("", todos.filter((item) => !item.heading_id), { project_id: id, heading_id: "" }));
    openHeadings.forEach((heading) => {
        parts.push(headingHTML(heading) + bucket("", todos.filter((item) => item.heading_id === heading.id), { project_id: id, heading_id: heading.id }));
    });
    if (archivedHeadings.length) {
        parts.push(`<div class="group-label">Archived</div>`);
        archivedHeadings.forEach((heading) => {
            parts.push(headingHTML(heading) + bucket("", todos.filter((item) => item.heading_id === heading.id), { project_id: id, heading_id: heading.id }));
        });
    }
    if (!todos.length && !openHeadings.length) parts.push(`<div class="empty"><strong>No to-dos</strong>Drag + left of the list to make a heading.</div>`);
    parts.push(`<button class="text-btn" data-action="new-heading" type="button">New Heading</button> <button class="text-btn" data-action="archive-project" type="button">${project.archived ? "Unarchive" : "Archive project"}</button> <button class="text-btn danger" data-action="delete-project" type="button">Delete project</button>`);
    return parts.join("");
}
function areaHTML(id) {
    const projects = state.projects.filter((project) => project.area_id === id && !project.archived).sort(byPos);
    if (!projects.length) return `<div class="empty"><strong>No projects</strong>Create one from the sidebar.</div>`;
    return projects.map((project) => `<div class="group-label">${esc(project.title)}</div>` + bucket("", state.todos.filter((item) => alive(item) && item.project_id === project.id), { project_id: project.id, heading_id: "" })).join("");
}
function headingHTML(heading) {
    return `<div class="heading" draggable="true" data-drag="heading:${esc(heading.id)}" data-heading="${esc(heading.id)}"><span class="heading-title" data-action="edit-heading" data-id="${esc(heading.id)}">${esc(heading.title)}</span><button class="text-btn" data-action="archive-heading" data-id="${esc(heading.id)}" type="button">${heading.archived ? "Unarchive" : "Archive"}</button></div>`;
}
function bucket(label, items, patch) {
    const late = label === "Overdue" || label === "Deadlines" ? " late" : "";
    const head = label ? `<div class="group-label${late}">${esc(label)}</div>` : "";
    return `${head}<div class="bucket" data-patch='${JSON.stringify(patch)}'>${items.map((item) => rowHTML(item, patch)).join("")}</div>`;
}
function rowsOrEmpty(items, title, sub, patch = {}) {
    if (!items.length) return `<div class="empty"><strong>${esc(title)}</strong>${esc(sub)}</div><div class="bucket" data-patch='${JSON.stringify(patch)}'></div>`;
    return bucket("", items, patch);
}
function calendarBlock(events, date) {
    if (!events.length && ui.view !== "today") return "";
    const rows = events.map((event) => {
        const cal = calendarById(event.calendar_id);
        return `<button class="event" data-action="edit-event" data-id="${esc(event.id)}" type="button"><time>${esc(event.start_time || "")}</time><i style="background:${esc(cal?.color || "#4c7dff")}"></i><span>${esc(event.title)}</span></button>`;
    }).join("");
    const add = `<button class="text-btn" data-action="new-event" data-date="${esc(date)}" type="button">Add event</button>`;
    const toggles = state.calendars.map((cal) => `<button class="text-btn" data-action="toggle-cal" data-id="${esc(cal.id)}" type="button">${cal.visible ? "Hide" : "Show"} ${esc(cal.title)}</button>`).join(" ");
    if (!events.length && ui.view !== "today") return "";
    return `<div class="calendar-block">${rows}${add} ${toggles}</div>`;
}
function rowHTML(item) {
    const selected = ui.selected.includes(item.id) ? " selected" : "";
    const project = projectById(item.project_id);
    const meta = [];
    if (project && ui.view !== "project:" + project.id) meta.push(project.title);
    const when = formatWhen(item);
    if (when && ui.view !== "today" && ui.view !== "someday" && ui.view !== "upcoming") meta.push(when);
    if (ui.view === "today" && item.when_date < state.today) meta.push(formatShort(item.when_date));
    if (item.checks?.length) meta.push(item.checks.filter((check) => check.done).length + "/" + item.checks.length);
    item.tag_ids.map(tagById).filter(Boolean).forEach((tag) => meta.push(tag.title));
    const side = [];
    if (item.reminder_at) side.push(`<span title="${esc(item.reminder_at)}">${AppleEmojis.img("alarm-clock", 14)}</span>`);
    if (item.repeat_every) side.push(`<span title="Repeats every ${item.repeat_every} ${item.repeat_unit}">${AppleEmojis.img("repeat-button", 14)}</span>`);
    if (item.deadline) side.push(`<span class="deadline${item.deadline < state.today ? " late" : ""}">${esc(formatShort(item.deadline))}</span>`);
    const done = item.completed_at ? " on" : "";
    const titleClass = item.completed_at ? " done-title" : "";
    return `<div class="row${selected}" data-id="${esc(item.id)}" draggable="true" data-drag="todo:${esc(item.id)}"><button class="sched" data-action="schedule" data-id="${esc(item.id)}" type="button" title="When">${AppleEmojis.img("calendar", 16)}</button><button class="check${done}" data-action="toggle" data-id="${esc(item.id)}" type="button" aria-label="Complete">${item.completed_at ? CHECK : ""}</button><div class="row-main"><div class="title${titleClass}">${esc(item.title || "New To-Do")}</div>${meta.length ? `<div class="meta">${meta.map(esc).join(" · ")}</div>` : ""}</div><div class="row-side">${side.join("")}</div></div>`;
}

function contextPatch() {
    if (ui.view === "today") return { when_date: state.today, evening: 0, someday: 0 };
    if (ui.view === "upcoming") return { when_date: addDaysISO(state.today, 1), evening: 0, someday: 0 };
    if (ui.view === "someday") return { someday: 1, when_date: "", evening: 0 };
    if (ui.view === "anytime") return { project_id: state.projects.find((project) => !project.archived)?.id || "", when_date: "", someday: 0 };
    if (ui.view.startsWith("project:")) return { project_id: ui.view.slice(8), heading_id: "", someday: 0 };
    if (ui.view.startsWith("area:")) {
        const project = state.projects.find((item) => item.area_id === ui.view.slice(5) && !item.archived);
        return project ? { project_id: project.id } : {};
    }
    if (ui.view.startsWith("tag:")) return { tag_ids: [ui.view.slice(4)] };
    return { project_id: "", heading_id: "", someday: 0 };
}
async function createTodo(extra = {}, open = true) {
    const data = await mutate("todo.create", Object.assign({ title: "", undo: true }, extra));
    if (open && data.created_id) {
        ui.openId = data.created_id;
        ui.paperSnap = false;
        ui.selected = [data.created_id];
        render();
        $("#paper-title")?.focus();
        $("#paper-title")?.select();
    }
    return data;
}

function renderPaper() {
    const host = $("#paper");
    const item = ui.openId ? todo(ui.openId) : null;
    if (!item) { host.hidden = true; host.innerHTML = ""; host.dataset.id = ""; return; }
    host.hidden = false;
    const active = document.activeElement;
    if (host.dataset.id === item.id && host.contains(active) && (active.tagName === "INPUT" || active.tagName === "TEXTAREA")) return;
    host.dataset.id = item.id;
    const tags = item.tag_ids.map(tagById).filter(Boolean).map((tag) => `<button class="tag" data-action="remove-tag" data-id="${esc(tag.id)}" type="button">${esc(tag.title)} ×</button>`).join("");
    const checks = (item.checks || []).map((check) => `<div class="check-row"><button class="mini-check${check.done ? " on" : ""}" data-action="toggle-check" data-id="${esc(check.id)}" type="button">${check.done ? CHECK : ""}</button><input data-check="${esc(check.id)}" value="${esc(check.title)}" aria-label="Checklist item"></div>`).join("");
    const repeat = `${item.repeat_every || 0}:${item.repeat_unit || "week"}`;
    host.innerHTML = `<div class="paper" role="dialog" aria-label="To-Do"><input id="paper-title" class="paper-title" value="${esc(item.title)}" placeholder="New To-Do" aria-label="Title"><textarea id="paper-notes" placeholder="Notes" aria-label="Notes">${esc(item.notes || "")}</textarea><div class="checks">${checks}<button class="quiet" data-action="add-check" type="button">Add checklist item</button></div><div class="tags">${tags}<input id="tag-input" placeholder="Add tag" aria-label="Add tag"></div><div class="paper-foot"><div class="paper-fields"><button class="quiet" data-action="schedule" data-id="${esc(item.id)}" type="button">${esc(formatWhen(item) || "When")}</button><label class="field">Deadline<input id="paper-deadline" type="date" value="${esc(item.deadline || "")}"></label><label class="field">Remind<input id="paper-remind" type="datetime-local" value="${esc((item.reminder_at || "").replace(" ", "T").slice(0, 16))}"></label><select id="paper-repeat" aria-label="Repeat"><option value="0:week">Does not repeat</option><option value="1:day">Every day</option><option value="1:week">Every week</option><option value="1:month">Every month</option><option value="1:year">Every year</option></select><button class="quiet" data-action="move" type="button">Move</button></div><div class="paper-actions"><button class="quiet" data-action="toggle" data-id="${esc(item.id)}" type="button">${item.completed_at ? "Mark incomplete" : "Complete"}</button><button class="quiet danger" data-action="trash" data-id="${esc(item.id)}" type="button">${item.trashed_at ? "Restore" : "Trash"}</button><button class="quiet" data-action="close-paper" type="button">Close</button></div></div></div>`;
    $("#paper-repeat").value = ["1:day", "1:week", "1:month", "1:year"].includes(repeat) ? repeat : "0:week";
    $("#paper-title").focus();
}
function paperFields() {
    const repeat = ($("#paper-repeat")?.value || "0:week").split(":");
    const checks = $$("[data-check]").map((input, index) => ({ id: input.dataset.check, title: input.value, done: input.previousElementSibling.classList.contains("on") ? 1 : 0, position: index + 1 }));
    return {
        title: $("#paper-title")?.value ?? "",
        notes: $("#paper-notes")?.value ?? "",
        deadline: $("#paper-deadline")?.value || "",
        reminder_at: ($("#paper-remind")?.value || "").replace("T", " "),
        repeat_every: Number(repeat[0]) || "",
        repeat_unit: repeat[1] || "week",
        checks
    };
}
function savePaper(discrete) {
    if (!ui.openId || !todo(ui.openId)) return;
    const undo = discrete || !ui.paperSnap;
    ui.paperSnap = true;
    clearTimeout(saveTimer);
    const run = () => mutate("todo.update", Object.assign({ id: ui.openId, undo }, paperFields()), { quiet: true });
    if (discrete) run();
    else saveTimer = setTimeout(run, 280);
}
function closePaper() {
    const item = ui.openId ? todo(ui.openId) : null;
    const empty = item && !item.title.trim() && !item.notes.trim() && !(item.checks || []).length;
    const id = ui.openId;
    ui.openId = null;
    ui.paperSnap = false;
    $("#paper").dataset.id = "";
    if (empty) mutate("todo.delete", { ids: [id], undo: false });
    else render();
}

function renderJump() {
    const host = $("#jump");
    if (!ui.jump) { host.hidden = true; return; }
    host.hidden = false;
    host.style.left = Math.min(ui.jump.x, window.innerWidth - 300) + "px";
    host.style.top = Math.min(ui.jump.y, window.innerHeight - 420) + "px";
    const item = todo(ui.jump.id);
    const month = ui.jump.month || state.today.slice(0, 7);
    host.innerHTML = `<button class="menu-item" data-action="when" data-when="today" type="button">${AppleEmojis.img("star", 16)}<span>Today</span></button><button class="menu-item" data-action="when" data-when="evening" type="button">${AppleEmojis.img("crescent-moon", 16)}<span>This Evening</span></button><button class="menu-item" data-action="when" data-when="tomorrow" type="button">${AppleEmojis.img("sunrise", 16)}<span>Tomorrow</span></button><button class="menu-item" data-action="when" data-when="someday" type="button">${AppleEmojis.img("file-folder", 16)}<span>Someday</span></button><button class="menu-item" data-action="when" data-when="clear" type="button">${AppleEmojis.img("cross-mark", 16)}<span>Clear date</span></button><div class="sep"></div><input id="natural" class="field-input" placeholder="tomorrow, sat, in 4 days, wed 8pm" aria-label="Natural date" value="${esc(ui.jump.q || "")}"><div class="cal-nav"><button data-action="month" data-dir="-1" type="button" aria-label="Previous month">‹</button><span>${esc(monthLabel(month))}</span><button data-action="month" data-dir="1" type="button" aria-label="Next month">›</button></div>${monthGrid(month, item?.when_date)}`;
    $("#natural")?.focus();
}
function monthLabel(month) {
    const [y, m] = month.split("-").map(Number);
    return new Date(y, m - 1, 1).toLocaleDateString(undefined, { month: "long", year: "numeric" });
}
function monthGrid(month, selected) {
    const [y, m] = month.split("-").map(Number);
    const first = new Date(y, m - 1, 1);
    const start = (first.getDay() + 6) % 7;
    const days = new Date(y, m, 0).getDate();
    let html = `<div class="cal-grid"><span>M</span><span>T</span><span>W</span><span>T</span><span>F</span><span>S</span><span>S</span>`;
    for (let i = 0; i < start; i++) html += "<span></span>";
    for (let day = 1; day <= days; day++) {
        const iso = y + "-" + String(m).padStart(2, "0") + "-" + String(day).padStart(2, "0");
        const cls = (iso === state.today ? " today" : "") + (iso === selected ? " on" : "");
        html += `<button class="${cls}" data-action="pick-day" data-date="${iso}" type="button">${day}</button>`;
    }
    return html + "</div>";
}
async function applyWhen(id, patch) {
    const ids = ui.selected.includes(id) && ui.selected.length > 1 ? ui.selected.slice() : [id];
    if (ids.length > 1) await mutate("batch", { ids, patch, undo: true });
    else await mutate("todo.update", Object.assign({ id, undo: true }, patch));
    ui.jump = null;
    render();
}
function patchFromNatural(text) {
    const parsed = ThingsDates.parseNatural(text, serverNow());
    if (!parsed) return null;
    if (parsed.clear) return { when_date: "", evening: 0, someday: 0, reminder_at: "" };
    if (parsed.deadline) return { deadline: parsed.deadline };
    const patch = { when_date: parsed.when_date || "", evening: parsed.evening ? 1 : 0, someday: parsed.someday ? 1 : 0 };
    if (parsed.reminder && parsed.when_date) patch.reminder_at = parsed.when_date + " " + parsed.reminder + ":00";
    return patch;
}

function renderQuick() {
    const host = $("#quick");
    if (!ui.quick) { host.hidden = true; host.innerHTML = ""; return; }
    host.hidden = false;
    if (!$("#quick-input")) host.innerHTML = `<div class="quick-card"><input id="quick-input" placeholder="Quick Find" aria-label="Quick Find"><div id="quick-results"></div></div>`;
    const input = $("#quick-input");
    if (document.activeElement !== input) {
        input.value = ui.quick.q;
        input.focus();
    }
    const results = quickResults(ui.quick.q);
    ui.quick.results = results;
    if (ui.quick.index >= results.length) ui.quick.index = 0;
    $("#quick-results").innerHTML = results.map((result, index) => `<button class="result${index === ui.quick.index ? " active" : ""}" data-action="quick-go" data-index="${index}" type="button"><span>${esc(result.label)}</span><small>${esc(result.hint)}</small></button>`).join("") || `<div class="meta" style="padding:10px">No matches</div>`;
}
function destinations() {
    const rows = [
        ["inbox", "Inbox", "List"], ["today", "Today", "List"], ["upcoming", "Upcoming", "List"], ["anytime", "Anytime", "List"], ["someday", "Someday", "List"], ["logbook", "Logbook", "List"], ["trash", "Trash", "List"]
    ].map(([view, label, hint]) => ({ label, hint, go: view }));
    state.areas.forEach((area) => rows.push({ label: area.title, hint: "Area", go: "area:" + area.id }));
    state.projects.forEach((project) => rows.push({ label: project.title, hint: "Project", go: "project:" + project.id }));
    state.tags.forEach((tag) => rows.push({ label: tag.title, hint: "Tag", go: "tag:" + tag.id }));
    return rows;
}
function quickResults(q) {
    const query = q.trim().toLowerCase();
    const dest = destinations().filter((item) => !query || item.label.toLowerCase().includes(query));
    const todos = state.todos.filter((item) => !item.trashed_at && (!query || (item.title + " " + item.notes).toLowerCase().includes(query))).slice(0, 8).map((item) => ({
        label: item.title || "New To-Do",
        hint: projectById(item.project_id)?.title || (item.completed_at ? "Logbook" : "To-Do"),
        go: "todo:" + item.id
    }));
    return dest.slice(0, 6).concat(todos);
}
function goResult(result) {
    ui.quick = null;
    if (!result) return;
    if (result.go.startsWith("todo:")) {
        const item = todo(result.go.slice(5));
        if (!item) return;
        ui.openId = item.id;
        ui.paperSnap = false;
        if (item.trashed_at) navigate("trash", { keepOpen: true });
        else if (item.completed_at) navigate("logbook", { keepOpen: true });
        else if (item.project_id) navigate("project:" + item.project_id, { keepOpen: true });
        else navigate(item.someday ? "someday" : "inbox", { keepOpen: true });
        render();
        return;
    }
    navigate(result.go);
}

function renderDialog() {
    const host = $("#dialog");
    if (!ui.dialog) { host.hidden = true; host.innerHTML = ""; return; }
    host.hidden = false;
    host.innerHTML = `<div class="dialog-card popover"><div class="popover-title">${esc(ui.dialog.title)}</div>${ui.dialog.body}<div class="dialog-actions"><button class="quiet" data-action="dialog-cancel" type="button">Cancel</button><button class="primary" data-action="dialog-save" type="button">Save</button></div></div>`;
    host.querySelector("input,textarea")?.focus();
}
function renderBatch() {
    let bar = $("#batch");
    if (ui.selected.length < 2) { bar?.remove(); return; }
    if (!bar) {
        bar = document.createElement("div");
        bar.id = "batch";
        bar.className = "batch-bar";
        document.body.appendChild(bar);
    }
    bar.innerHTML = `<span>${ui.selected.length} selected</span><button data-action="batch-complete" type="button">Complete</button><button data-action="batch-today" type="button">Today</button><button data-action="batch-evening" type="button">Evening</button><button data-action="move" type="button">Move</button><button data-action="batch-trash" type="button">Trash</button><button data-action="clear-selection" type="button">Clear</button>`;
}

function toast(message, undoable = false) {
    const el = $("#toast");
    el.hidden = false;
    el.innerHTML = "";
    const span = document.createElement("span");
    span.textContent = message;
    el.appendChild(span);
    if (undoable) {
        const button = document.createElement("button");
        button.type = "button";
        button.textContent = "Undo";
        button.addEventListener("click", () => mutate("undo", { undo: false }));
        el.appendChild(button);
    }
    clearTimeout(toast._t);
    toast._t = setTimeout(() => { el.hidden = true; }, 4200);
}

function openSchedule(id, x, y) {
    ui.jump = { id, x, y, month: (todo(id)?.when_date || state.today).slice(0, 7), q: "" };
    renderJump();
}
function selectOnly(id, event) {
    const rows = $$(".row").map((row) => row.dataset.id);
    if (event.shiftKey && ui.selected.length) {
        const a = rows.indexOf(ui.selected[ui.selected.length - 1]);
        const b = rows.indexOf(id);
        const [from, to] = a < b ? [a, b] : [b, a];
        ui.selected = rows.slice(from, to + 1);
        return;
    }
    if (event.metaKey || event.ctrlKey) {
        ui.selected = ui.selected.includes(id) ? ui.selected.filter((item) => item !== id) : ui.selected.concat(id);
        return;
    }
    ui.selected = [id];
}

async function onDrop(event) {
    const raw = event.dataTransfer.getData("text/plain") || ui.dragging || "";
    const patchEl = event.target.closest("[data-patch], #inbox-drop, [data-view]");
    let patch = {};
    if (event.target.closest("#inbox-drop")) patch = { project_id: "", heading_id: "", someday: 0, evening: 0 };
    else if (patchEl?.dataset.patch) patch = JSON.parse(patchEl.dataset.patch);
    else if (patchEl?.dataset.view) patch = patchForView(patchEl.dataset.view) || {};
    const before = event.target.closest(".row")?.dataset.id || "";
    if (raw === "magic") {
        await createTodo(Object.assign({}, patch, before ? { before_id: before } : {}));
        return;
    }
    if (raw.startsWith("todo:")) {
        const id = raw.slice(5);
        const moving = ui.selected.includes(id) && ui.selected.length > 1 ? ui.selected.slice() : [id];
        const bucket = event.target.closest(".bucket, .day");
        let ids = bucket ? $$(".row", bucket).map((row) => row.dataset.id).filter((item) => !moving.includes(item)) : [];
        const index = before ? ids.indexOf(before) : ids.length;
        ids.splice(index < 0 ? ids.length : index, 0, ...moving);
        await mutate("todo.reorder", { ids, moving, patch, undo: true });
        return;
    }
    if (raw.startsWith("heading:")) {
        const id = raw.slice(8);
        const projectId = headingById(id)?.project_id;
        const ids = state.headings.filter((heading) => heading.project_id === projectId).sort(byPos).map((heading) => heading.id).filter((item) => item !== id);
        const beforeHeading = event.target.closest("[data-heading]")?.dataset.heading;
        const index = beforeHeading ? ids.indexOf(beforeHeading) : ids.length;
        ids.splice(index < 0 ? ids.length : index, 0, id);
        await mutate("heading.reorder", { ids, undo: true });
        return;
    }
    if (raw.startsWith("project:")) {
        const id = raw.slice(8);
        const ids = state.projects.map((project) => project.id).filter((item) => item !== id);
        const beforeProject = event.target.closest("[data-view]")?.dataset.view || "";
        const beforeId = beforeProject.startsWith("project:") ? beforeProject.slice(8) : "";
        const index = beforeId ? ids.indexOf(beforeId) : ids.length;
        ids.splice(index < 0 ? ids.length : index, 0, id);
        await mutate("project.reorder", { ids, undo: true });
    }
}
function patchForView(view) {
    if (view === "inbox") return { project_id: "", heading_id: "", someday: 0 };
    if (view === "today") return { when_date: state.today, evening: 0, someday: 0 };
    if (view === "someday") return { someday: 1, when_date: "", evening: 0 };
    if (view === "anytime") return { when_date: "", evening: 0, someday: 0 };
    if (view.startsWith("project:")) return { project_id: view.slice(8), heading_id: "" };
    return null;
}

function bind() {
    document.addEventListener("click", async (e) => {
        if (e.target.closest("#jump") && !e.target.closest("[data-action]")) return;
        if (!e.target.closest("#jump") && ui.jump && !e.target.closest("[data-action='schedule']")) {
            ui.jump = null;
            renderJump();
        }
        const nav = e.target.closest("[data-view]");
        if (nav && e.target.closest("#sidebar") && !e.target.closest("[data-action]")) {
            navigate(nav.dataset.view);
            return;
        }
        const actionEl = e.target.closest("[data-action]");
        if (!actionEl) {
            if (e.target.id === "paper" || e.target.id === "quick" || e.target.id === "dialog") {
                if (e.target.id === "paper") closePaper();
                if (e.target.id === "quick") ui.quick = null;
                if (e.target.id === "dialog") ui.dialog = null;
                render();
                return;
            }
            const row = e.target.closest(".row");
            if (row) {
                if (e.metaKey || e.ctrlKey || e.shiftKey) {
                    selectOnly(row.dataset.id, e);
                    renderChrome();
                    renderBatch();
                    return;
                }
                ui.openId = row.dataset.id;
                ui.paperSnap = false;
                ui.selected = [row.dataset.id];
                $("#paper").dataset.id = "";
                render();
            }
            return;
        }
        const action = actionEl.dataset.action;
        const id = actionEl.dataset.id;
        if (action === "toggle") {
            e.stopPropagation();
            const item = todo(id);
            if (!item) return;
            if (item.trashed_at) return mutate("todo.restore", { ids: [id], undo: true });
            const repeating = item.repeat_every;
            await mutate(item.completed_at ? "todo.uncomplete" : "todo.complete", { id, undo: true });
            toast(item.completed_at ? "Marked incomplete" : repeating ? "Completed. The next one is scheduled." : "Completed", true);
        } else if (action === "schedule") {
            e.stopPropagation();
            const rect = actionEl.getBoundingClientRect();
            openSchedule(id || ui.openId, rect.left, rect.bottom + 6);
        } else if (action === "trash") {
            const item = todo(id);
            if (item?.trashed_at) await mutate("todo.restore", { ids: [id], undo: true });
            else {
                await mutate("todo.trash", { ids: [id], undo: true });
                toast("Moved to Trash", true);
            }
        } else if (action === "close-paper") closePaper();
        else if (action === "when") {
            const kind = actionEl.dataset.when;
            const patch = kind === "today" ? { when_date: state.today, evening: 0, someday: 0 }
                : kind === "evening" ? { when_date: state.today, evening: 1, someday: 0 }
                : kind === "tomorrow" ? { when_date: addDaysISO(state.today, 1), evening: 0, someday: 0 }
                : kind === "someday" ? { someday: 1, when_date: "", evening: 0 }
                : { when_date: "", evening: 0, someday: 0 };
            applyWhen(ui.jump.id, patch);
        } else if (action === "pick-day") applyWhen(ui.jump.id, { when_date: actionEl.dataset.date, evening: 0, someday: 0 });
        else if (action === "month") {
            const [y, m] = ui.jump.month.split("-").map(Number);
            const next = new Date(y, m - 1 + Number(actionEl.dataset.dir), 1);
            ui.jump.month = next.getFullYear() + "-" + String(next.getMonth() + 1).padStart(2, "0");
            renderJump();
        } else if (action === "quick-go") goResult(ui.quick.results[Number(actionEl.dataset.index)]);
        else if (action === "slim") {
            ui.slim = !ui.slim;
            localStorage.setItem("things-slim", ui.slim ? "1" : "0");
            render();
        } else if (action === "theme") {
            ui.theme = ui.theme === "dark" ? "light" : "dark";
            localStorage.setItem("things-theme", ui.theme);
            render();
        } else if (action === "title-menu") {
            ui.quick = { q: "", index: 0 };
            renderQuick();
        } else if (action === "new-project") openNamedDialog("New Project", "project");
        else if (action === "new-area") openNamedDialog("New Area", "area");
        else if (action === "new-heading") {
            if (!ui.view.startsWith("project:")) return;
            const data = await mutate("heading.create", { project_id: ui.view.slice(8), title: "New Heading", undo: true });
            ui.editHeading = data.created_id;
            render();
        } else if (action === "edit-heading") startHeadingEdit(actionEl);
        else if (action === "archive-heading") {
            const heading = headingById(id);
            await mutate("heading.archive", { id, archived: heading && !heading.archived, undo: true });
        } else if (action === "archive-project") {
            const project = projectById(ui.view.slice(8));
            await mutate("project.archive", { id: project.id, archived: !project.archived, undo: true });
        } else if (action === "delete-project") {
            const project = projectById(ui.view.slice(8));
            if (project && confirm(`Delete “${project.title}”? Its to-dos return to Inbox.`)) {
                await mutate("project.delete", { id: project.id, undo: true });
                navigate("inbox");
            }
        } else if (action === "project-notes") return;
        else if (action === "reset") {
            if (confirm("Reset to the sample list? This replaces what is saved.")) await mutate("reset", { undo: true });
        } else if (action === "toggle-archived") { ui.showArchived = !ui.showArchived; renderSidebar(); }
        else if (action === "toggle-cal") {
            const cal = calendarById(id);
            await mutate("calendar.update", { id, visible: cal && !cal.visible, undo: false }, { quiet: true });
            render();
        } else if (action === "new-event") openEventDialog(null, actionEl.dataset.date);
        else if (action === "edit-event") openEventDialog(id);
        else if (action === "add-check") {
            const fields = paperFields();
            fields.checks.push({ title: "New item", done: 0 });
            await mutate("todo.update", Object.assign({ id: ui.openId, undo: !ui.paperSnap }, fields), { quiet: true });
            ui.paperSnap = true;
            $("#paper").dataset.id = "";
            renderPaper();
        } else if (action === "toggle-check") {
            actionEl.classList.toggle("on");
            actionEl.innerHTML = actionEl.classList.contains("on") ? CHECK : "";
            savePaper(true);
        } else if (action === "remove-tag") {
            const item = todo(ui.openId);
            await mutate("todo.update", { id: ui.openId, tag_ids: item.tag_ids.filter((tag) => tag !== id), undo: true });
            $("#paper").dataset.id = "";
            renderPaper();
        } else if (action === "move") openMoveMenu(e.clientX, e.clientY);
        else if (action === "move-to") {
            const ids = ui.selected.length ? ui.selected.slice() : [ui.openId];
            await mutate("batch", { ids, patch: { project_id: actionEl.dataset.project, heading_id: "" }, undo: true });
            ui.dialog = null;
            $(".menu-card")?.remove();
        } else if (action === "batch-complete") {
            await mutate("batch", { ids: ui.selected.slice(), complete: 1, undo: true });
            ui.selected = [];
            toast("Completed", true);
        } else if (action === "batch-today") await mutate("batch", { ids: ui.selected.slice(), patch: { when_date: state.today, evening: 0, someday: 0 }, undo: true });
        else if (action === "batch-evening") await mutate("batch", { ids: ui.selected.slice(), patch: { when_date: state.today, evening: 1, someday: 0 }, undo: true });
        else if (action === "batch-trash") {
            await mutate("batch", { ids: ui.selected.slice(), trash: 1, undo: true });
            ui.selected = [];
            toast("Moved to Trash", true);
        } else if (action === "clear-selection") { ui.selected = []; render(); }
        else if (action === "dialog-cancel") { ui.dialog = null; renderDialog(); }
        else if (action === "dialog-save") saveDialog();
        else if (action === "pick-emoji") {
            const kind = actionEl.dataset.kind;
            const current = kind === "area" ? state.areas.find((area) => area.id === actionEl.dataset.id)?.emoji : projectById(actionEl.dataset.id)?.emoji;
            openEmojiPicker(kind, actionEl.dataset.id, current);
        } else if (action === "choose-emoji") {
            const name = actionEl.dataset.name;
            if (ui.dialog?.kind === "emoji") {
                const actionName = ui.dialog.targetKind === "area" ? "area.update" : "project.update";
                await mutate(actionName, { id: ui.dialog.targetId, emoji: name, undo: true });
                ui.dialog = null;
                render();
            } else if (ui.dialog) {
                ui.dialog.emoji = name;
                const img = $("#dialog .emoji");
                if (img) img.src = AppleEmojis.url(name);
                drawEmojiGrid($("#emoji-search")?.value || "");
            }
        }
        else if (action === "empty-trash") {
            if (confirm("Empty the trash forever?")) await mutate("todo.emptyTrash", { undo: true });
        }
    });
    document.addEventListener("input", (e) => {
        if (e.target.id === "paper-title" || e.target.id === "paper-notes" || e.target.matches("[data-check]")) savePaper(false);
        if (e.target.id === "natural") ui.jump.q = e.target.value;
        if (e.target.id === "quick-input") {
            ui.quick.q = e.target.value;
            ui.quick.index = 0;
            const exact = destinations().find((item) => item.label.toLowerCase() === ui.quick.q.trim().toLowerCase());
            if (exact && ui.quick.q.trim().length > 2) { goResult(exact); return; }
            renderQuick();
        }
        if (e.target.dataset.action === "rename-view") return;
    });
    document.addEventListener("change", (e) => {
        if (["paper-deadline", "paper-remind", "paper-repeat"].includes(e.target.id)) savePaper(true);
        if (e.target.dataset.action === "project-notes") {
            mutate("project.update", { id: ui.view.slice(8), notes: e.target.value, undo: true }, { quiet: true });
        }
        if (e.target.dataset.action === "rename-view") renameView(e.target.value);
    });
    document.addEventListener("keydown", (e) => {
        if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "z" && !typing(e.target)) {
            e.preventDefault();
            mutate("undo", { undo: false });
            return;
        }
        if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "n") {
            e.preventDefault();
            if (e.shiftKey && ui.view.startsWith("project:")) mutate("heading.create", { project_id: ui.view.slice(8), title: "New Heading", undo: true });
            else createTodo(contextPatch());
            return;
        }
        if (e.key === "Enter" && e.target.id === "natural") {
            e.preventDefault();
            const patch = patchFromNatural(e.target.value);
            if (!patch) { toast("Could not read that date"); return; }
            applyWhen(ui.jump.id, patch);
            return;
        }
        if (e.key === "Enter" && e.target.id === "tag-input") {
            e.preventDefault();
            const name = e.target.value.trim();
            if (!name) return;
            mutate("todo.update", { id: ui.openId, new_tag: name, undo: true }).then(() => { $("#paper").dataset.id = ""; renderPaper(); });
            return;
        }
        if (e.key === "Enter" && e.target.id === "quick-input") {
            e.preventDefault();
            goResult(ui.quick.results[ui.quick.index]);
            return;
        }
        if (e.key === "Enter" && e.target.id === "dialog-name") { e.preventDefault(); saveDialog(); return; }
        if (ui.quick && (e.key === "ArrowDown" || e.key === "ArrowUp")) {
            e.preventDefault();
            ui.quick.index = Math.max(0, Math.min(ui.quick.results.length - 1, ui.quick.index + (e.key === "ArrowDown" ? 1 : -1)));
            renderQuick();
            return;
        }
        if (e.key === "Escape") {
            if (ui.quick) { ui.quick = null; renderQuick(); return; }
            if (ui.jump) { ui.jump = null; renderJump(); return; }
            if (ui.dialog) { ui.dialog = null; renderDialog(); return; }
            if (ui.openId) { closePaper(); return; }
            return;
        }
        if (typing(e.target)) return;
        if (e.key === "ArrowDown" || e.key === "ArrowUp") {
            e.preventDefault();
            moveSelection(e.key === "ArrowDown" ? 1 : -1);
            return;
        }
        if ((e.key === "Enter" || e.key === "o") && ui.selected[0]) {
            ui.openId = ui.selected[0];
            ui.paperSnap = false;
            $("#paper").dataset.id = "";
            render();
            return;
        }
        if ((e.metaKey || e.ctrlKey) && e.key === "Enter" && (ui.openId || ui.selected[0])) {
            e.preventDefault();
            const id = ui.openId || ui.selected[0];
            mutate("todo.complete", { id, undo: true });
            return;
        }
        if ((e.key === "Backspace" || e.key === "Delete") && ui.selected.length && !ui.openId) {
            e.preventDefault();
            mutate("todo.trash", { ids: ui.selected.slice(), undo: true });
            ui.selected = [];
            return;
        }
        if (e.key.length === 1 && !e.metaKey && !e.ctrlKey && !e.altKey) {
            ui.quick = { q: e.key, index: 0 };
            renderQuick();
        }
    });
    document.addEventListener("dragstart", (e) => {
        const drag = e.target.closest("[data-drag]");
        if (!drag) return;
        ui.dragging = drag.dataset.drag;
        e.dataTransfer.setData("text/plain", drag.dataset.drag);
        e.dataTransfer.effectAllowed = "move";
    });
    document.addEventListener("dragover", (e) => {
        if (!ui.dragging && !document.body.classList.contains("dragging-plus")) return;
        const zone = e.target.closest(".row, .bucket, .day, .heading, [data-view], #inbox-drop");
        if (!zone) return;
        e.preventDefault();
        $$(".drop-line").forEach((el) => el.classList.remove("drop-line"));
        zone.classList.add("drop-line");
    });
    document.addEventListener("drop", (e) => {
        if (!e.dataTransfer.getData("text/plain") && !ui.dragging) return;
        e.preventDefault();
        onDrop(e).catch((err) => toast(err.message));
        $$(".drop-line").forEach((el) => el.classList.remove("drop-line"));
        ui.dragging = null;
    });
    document.addEventListener("paste", (e) => {
        if (e.target.id !== "paper-notes") return;
        const text = e.clipboardData.getData("text/plain");
        const lines = text.split(/\n/).map((line) => line.replace(/^\s*([-*•]|\d+[.)])\s+/, "")).filter((line, index, all) => line && (all.length > 1));
        if (!/^(\s*([-*•]|\d+[.)])\s+.+\n?){2,}/.test(text)) return;
        e.preventDefault();
        const fields = paperFields();
        lines.forEach((line) => fields.checks.push({ title: line, done: 0 }));
        mutate("todo.update", Object.assign({ id: ui.openId, undo: true }, fields)).then(() => { $("#paper").dataset.id = ""; renderPaper(); });
    });
    window.addEventListener("hashchange", () => navigate(hashView(), { fromHash: true }));
    window.addEventListener("popstate", () => navigate(hashView(), { fromHash: true }));
}
function typing(el) {
    if (!el) return false;
    const tag = el.tagName;
    return tag === "INPUT" || tag === "TEXTAREA" || tag === "SELECT" || el.isContentEditable;
}
function moveSelection(delta) {
    const ids = $$(".row").map((row) => row.dataset.id);
    if (!ids.length) return;
    let index = ids.indexOf(ui.selected[0]);
    if (index < 0) index = delta > 0 ? -1 : 0;
    index = Math.max(0, Math.min(ids.length - 1, index + delta));
    ui.selected = [ids[index]];
    renderChrome();
    $(`.row[data-id="${CSS.escape(ids[index])}"]`)?.scrollIntoView({ block: "nearest" });
}
function startHeadingEdit(el) {
    const id = el.dataset.id;
    const heading = headingById(id);
    el.outerHTML = `<input class="heading-edit" data-heading-edit="${esc(id)}" value="${esc(heading?.title || "")}">`;
    const input = $(`[data-heading-edit="${CSS.escape(id)}"]`);
    input?.focus();
    input?.select();
    input?.addEventListener("keydown", (e) => { if (e.key === "Enter") input.blur(); });
    input?.addEventListener("blur", () => mutate("heading.update", { id, title: input.value, undo: true }));
}
function emojiButton(kind, id, name, size) {
    return `<button class="emoji-btn" data-action="pick-emoji" data-kind="${esc(kind)}" data-id="${esc(id)}" type="button" title="Change emoji">${AppleEmojis.img(name, size)}</button>`;
}
function openEmojiPicker(kind, id, current) {
    ui.dialog = {
        title: "Apple emoji",
        kind: "emoji",
        targetKind: kind,
        targetId: id,
        emoji: current || "file-folder",
        body: `<input id="emoji-search" placeholder="Search, like beach or cake" aria-label="Search emojis" style="margin-top:12px"><div id="emoji-grid" class="emoji-grid"></div>`
    };
    renderDialog();
    drawEmojiGrid("");
    $("#emoji-search")?.addEventListener("input", (event) => drawEmojiGrid(event.target.value));
}
function drawEmojiGrid(query) {
    const grid = $("#emoji-grid");
    if (!grid) return;
    const current = ui.dialog?.emoji;
    grid.innerHTML = AppleEmojis.search(query).map((name) => `<button class="emoji-choice${name === current ? " on" : ""}" data-action="choose-emoji" data-name="${esc(name)}" type="button" title="${esc(name)}">${AppleEmojis.img(name, 28)}</button>`).join("");
}
function openNamedDialog(title, kind) {
    ui.dialog = {
        title,
        kind,
        emoji: kind === "area" ? "house" : "file-folder",
        body: `<div class="title-line" style="margin-top:16px">${AppleEmojis.img(kind === "area" ? "house" : "file-folder", 28)}<input id="dialog-name" placeholder="${esc(title)}" aria-label="${esc(title)}" style="font-size:18px"></div><input id="emoji-search" placeholder="Search Apple emojis" aria-label="Search emojis" style="margin-top:12px"><div id="emoji-grid" class="emoji-grid"></div>`
    };
    renderDialog();
    drawEmojiGrid("");
    $("#emoji-search")?.addEventListener("input", (event) => drawEmojiGrid(event.target.value));
    $("#dialog-name")?.focus();
}
function openEventDialog(id, date) {
    const event = id ? state.events.find((item) => item.id === id) : null;
    const options = state.calendars.map((cal) => `<option value="${esc(cal.id)}"${event && event.calendar_id === cal.id ? " selected" : ""}>${esc(cal.title)}</option>`).join("");
    ui.dialog = {
        title: event ? "Event" : "New Event",
        kind: "event",
        eventId: id,
        body: `<input id="dialog-name" value="${esc(event?.title || "")}" placeholder="Title" style="margin-top:12px;font-size:18px"><div class="paper-tools"><input id="event-date" type="date" value="${esc(event?.date || date || state.today)}"><input id="event-start" type="time" value="${esc(event?.start_time || "09:00")}"><input id="event-end" type="time" value="${esc(event?.end_time || "")}"><select id="event-cal">${options}</select></div><textarea id="event-notes" placeholder="Notes">${esc(event?.notes || "")}</textarea>${event ? `<button class="text-btn danger" id="event-delete" type="button">Delete event</button>` : ""}`
    };
    renderDialog();
    $("#event-delete")?.addEventListener("click", () => mutate("event.delete", { id, undo: true }).then(() => { ui.dialog = null; render(); }));
}
function openMoveMenu(x, y) {
    $(".menu-card")?.remove();
    const card = document.createElement("div");
    card.className = "menu-card";
    card.style.left = Math.min(x, window.innerWidth - 240) + "px";
    card.style.top = Math.min(y, window.innerHeight - 280) + "px";
    const items = [{ id: "", title: "Inbox" }].concat(state.projects.filter((project) => !project.archived));
    card.innerHTML = `<input id="move-filter" placeholder="Move to…" style="padding:8px" aria-label="Move to">` + items.map((project) => `<button data-action="move-to" data-project="${esc(project.id)}" type="button">${esc(project.title)}</button>`).join("");
    document.body.appendChild(card);
    const filter = $("#move-filter");
    filter.focus();
    filter.addEventListener("input", () => {
        const q = filter.value.toLowerCase();
        $$("button", card).forEach((button) => { button.hidden = q && !button.textContent.toLowerCase().includes(q); });
    });
}
async function saveDialog() {
    const dialog = ui.dialog;
    if (!dialog) return;
    const name = $("#dialog-name")?.value.trim();
    if (dialog.kind === "project") {
        if (!name) return;
        const data = await mutate("project.create", { title: name, emoji: dialog.emoji || "file-folder", area_id: ui.view.startsWith("area:") ? ui.view.slice(5) : "", undo: true });
        ui.dialog = null;
        navigate("project:" + data.created_id);
        return;
    }
    if (dialog.kind === "area") {
        if (!name) return;
        const data = await mutate("area.create", { title: name, emoji: dialog.emoji || "house", undo: true });
        ui.dialog = null;
        navigate("area:" + data.created_id);
        return;
    }
    if (dialog.kind === "event") {
        const payload = {
            title: name || "New Event",
            date: $("#event-date").value,
            start_time: $("#event-start").value,
            end_time: $("#event-end").value,
            calendar_id: $("#event-cal").value,
            notes: $("#event-notes").value,
            undo: true
        };
        if (dialog.eventId) await mutate("event.update", Object.assign({ id: dialog.eventId }, payload));
        else await mutate("event.create", payload);
        ui.dialog = null;
        render();
    }
}
async function renameView(value) {
    const title = value.trim();
    if (!title) return;
    if (ui.view.startsWith("project:")) await mutate("project.update", { id: ui.view.slice(8), title, undo: true }, { quiet: true });
    if (ui.view.startsWith("area:")) await mutate("area.update", { id: ui.view.slice(5), title, undo: true }, { quiet: true });
    render();
}
async function consumeQuery() {
    const params = new URLSearchParams(location.search);
    if (!params.get("add")) return;
    const when = params.get("when") || "";
    const parsed = when ? ThingsDates.parseNatural(when, serverNow()) : null;
    const project = state.projects.find((item) => item.title.toLowerCase() === (params.get("list") || "").toLowerCase());
    const patch = parsed ? patchFromNatural(when) : {};
    await createTodo(Object.assign({ title: params.get("add"), notes: params.get("notes") || "" }, patch, project ? { project_id: project.id } : {}), false);
    history.replaceState({}, "", location.pathname + viewHash(ui.view));
    toast("Added “" + params.get("add") + "”");
}
async function pollReminders() {
    try {
        const res = await fetch("api.php?action=reminders");
        const data = await res.json();
        if (!data.ok) return;
        state = data.state;
        const fresh = data.reminders.filter((item) => !reminded.has(item.id));
        if (!fresh.length) return;
        fresh.forEach((item) => reminded.add(item.id));
        toast("Reminder: " + fresh.map((item) => item.title).join(", "));
        if (Notification.permission === "granted") fresh.forEach((item) => new Notification("Things", { body: item.title }));
        else if (Notification.permission === "default") {
            const el = $("#toast");
            const button = document.createElement("button");
            button.textContent = "Enable alerts";
            button.onclick = () => Notification.requestPermission();
            el.appendChild(button);
        }
        await fetch("api.php", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ action: "reminders.ack", ids: fresh.map((item) => item.id), undo: false }) });
    } catch { /* ignore transient poll errors */ }
}

bind();
load().then(async () => {
    try { await AppleEmojis.load(); } catch { /* names still work; images stay blank if the file is missing */ }
    ui.view = knownView(hashView()) ? hashView() : "today";
    history.replaceState({ view: ui.view }, "", viewHash(ui.view));
    await consumeQuery();
    render();
    pollReminders();
    setInterval(pollReminders, 20000);
}).catch((err) => {
    $("#stage").innerHTML = `<div class="empty"><strong>Could not reach PHP</strong>${esc(err.message)}</div>`;
});
