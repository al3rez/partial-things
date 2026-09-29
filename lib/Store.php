<?php

declare(strict_types=1);

final class Store
{
    private PDO $db;

    public static function open(string $path): self
    {
        $dir = dirname($path);
        if (!is_dir($dir) && !mkdir($dir, 0775, true) && !is_dir($dir)) {
            throw new RuntimeException('Cannot create data directory');
        }
        $pdo = new PDO('sqlite:' . $path, null, null, [
            PDO::ATTR_ERRMODE => PDO::ERRMODE_EXCEPTION,
            PDO::ATTR_DEFAULT_FETCH_MODE => PDO::FETCH_ASSOC,
        ]);
        $store = new self($pdo);
        $store->migrate();
        return $store;
    }

    private function __construct(PDO $db)
    {
        $this->db = $db;
    }

    public function handle(string $action, array $body): array
    {
        if ($action === 'state') {
            return ['ok' => true, 'state' => $this->state()];
        }
        if ($action === 'reminders') {
            return ['ok' => true, 'reminders' => $this->dueReminders(), 'state' => $this->state()];
        }
        if ($action === 'reminders.ack') {
            $this->ackReminders($body['ids'] ?? []);
            return ['ok' => true, 'state' => $this->state()];
        }

        $this->db->beginTransaction();
        try {
            if (!array_key_exists('undo', $body) || $body['undo']) {
                $this->snapshot();
            }
            $created = null;
            switch ($action) {
                case 'undo':
                    $this->undo();
                    break;
                case 'reset':
                    $this->wipe();
                    $this->seed();
                    break;
                case 'todo.create':
                    $created = $this->createTodo($body);
                    break;
                case 'todo.update':
                    $this->updateTodo((string) ($body['id'] ?? ''), $body);
                    break;
                case 'todo.complete':
                    $this->completeTodo((string) ($body['id'] ?? ''));
                    break;
                case 'todo.uncomplete':
                    $this->setCompleted((string) ($body['id'] ?? ''), null);
                    break;
                case 'todo.trash':
                    foreach ($this->ids($body) as $id) {
                        $this->trashTodo($id, true);
                    }
                    break;
                case 'todo.restore':
                    foreach ($this->ids($body) as $id) {
                        $this->db->prepare('UPDATE todos SET trashed_at=NULL WHERE id=?')->execute([$id]);
                    }
                    break;
                case 'todo.delete':
                    foreach ($this->ids($body) as $id) {
                        $this->db->prepare('DELETE FROM todos WHERE id=?')->execute([$id]);
                    }
                    break;
                case 'todo.emptyTrash':
                    $this->db->exec("DELETE FROM todos WHERE trashed_at IS NOT NULL");
                    break;
                case 'todo.reorder':
                    $this->reorderTodos($body);
                    break;
                case 'batch':
                    $this->batch($body);
                    break;
                case 'heading.create':
                    $created = $this->createHeading($body);
                    break;
                case 'heading.update':
                    $this->db->prepare('UPDATE headings SET title=? WHERE id=?')->execute([
                        trim((string) ($body['title'] ?? '')),
                        (string) ($body['id'] ?? ''),
                    ]);
                    break;
                case 'heading.archive':
                    $this->db->prepare('UPDATE headings SET archived=? WHERE id=?')->execute([
                        !empty($body['archived']) ? 1 : 0,
                        (string) ($body['id'] ?? ''),
                    ]);
                    break;
                case 'heading.delete':
                    $this->db->prepare('DELETE FROM headings WHERE id=?')->execute([(string) ($body['id'] ?? '')]);
                    break;
                case 'heading.reorder':
                    $this->rewritePositions('headings', $body['ids'] ?? []);
                    break;
                case 'project.create':
                    $created = $this->createProject($body);
                    break;
                case 'project.update':
                    $this->updateProject($body);
                    break;
                case 'project.archive':
                    $this->db->prepare('UPDATE projects SET archived=? WHERE id=?')->execute([
                        !empty($body['archived']) ? 1 : 0,
                        (string) ($body['id'] ?? ''),
                    ]);
                    break;
                case 'project.delete':
                    $id = (string) ($body['id'] ?? '');
                    $this->db->prepare('UPDATE todos SET project_id=NULL, heading_id=NULL WHERE project_id=?')->execute([$id]);
                    $this->db->prepare('DELETE FROM projects WHERE id=?')->execute([$id]);
                    break;
                case 'project.reorder':
                    $this->rewritePositions('projects', $body['ids'] ?? []);
                    break;
                case 'area.create':
                    $created = $this->id();
                    $this->insert('areas', [
                        'id' => $created,
                        'title' => trim((string) ($body['title'] ?? 'New Area')) ?: 'New Area',
                        'emoji' => $this->emojiOrNull($body['emoji'] ?? null) ?? 'file-folder',
                        'position' => $this->nextPosition('areas'),
                    ]);
                    break;
                case 'area.update':
                    $id = (string) ($body['id'] ?? '');
                    if (array_key_exists('title', $body)) {
                        $this->db->prepare('UPDATE areas SET title=? WHERE id=?')->execute([
                            trim((string) ($body['title'] ?? '')) ?: 'Untitled',
                            $id,
                        ]);
                    }
                    if (array_key_exists('emoji', $body)) {
                        $this->db->prepare('UPDATE areas SET emoji=? WHERE id=?')->execute([
                            $this->emojiOrNull($body['emoji']),
                            $id,
                        ]);
                    }
                    break;
                case 'area.delete':
                    $id = (string) ($body['id'] ?? '');
                    $this->db->prepare('UPDATE projects SET area_id=NULL WHERE area_id=?')->execute([$id]);
                    $this->db->prepare('DELETE FROM areas WHERE id=?')->execute([$id]);
                    break;
                case 'tag.create':
                    $created = $this->findOrCreateTag((string) ($body['title'] ?? ''));
                    break;
                case 'tag.delete':
                    $this->db->prepare('DELETE FROM tags WHERE id=?')->execute([(string) ($body['id'] ?? '')]);
                    break;
                case 'event.create':
                    $created = $this->createEvent($body);
                    break;
                case 'event.update':
                    $this->updateEvent($body);
                    break;
                case 'event.delete':
                    $this->db->prepare('DELETE FROM events WHERE id=?')->execute([(string) ($body['id'] ?? '')]);
                    break;
                case 'calendar.create':
                    $created = $this->id();
                    $this->insert('calendars', [
                        'id' => $created,
                        'title' => trim((string) ($body['title'] ?? 'Calendar')) ?: 'Calendar',
                        'color' => $this->color((string) ($body['color'] ?? '#4c7dff')),
                        'visible' => 1,
                    ]);
                    break;
                case 'calendar.update':
                    $id = (string) ($body['id'] ?? '');
                    if (array_key_exists('title', $body)) {
                        $this->db->prepare('UPDATE calendars SET title=? WHERE id=?')->execute([trim((string) $body['title']) ?: 'Calendar', $id]);
                    }
                    if (array_key_exists('color', $body)) {
                        $this->db->prepare('UPDATE calendars SET color=? WHERE id=?')->execute([$this->color((string) $body['color']), $id]);
                    }
                    if (array_key_exists('visible', $body)) {
                        $this->db->prepare('UPDATE calendars SET visible=? WHERE id=?')->execute([!empty($body['visible']) ? 1 : 0, $id]);
                    }
                    break;
                default:
                    throw new InvalidArgumentException('Unknown action');
            }
            $this->db->commit();
        } catch (Throwable $e) {
            if ($this->db->inTransaction()) {
                $this->db->rollBack();
            }
            throw $e;
        }
        $out = ['ok' => true, 'state' => $this->state()];
        if ($created) {
            $out['created_id'] = $created;
        }
        return $out;
    }

    public function state(): array
    {
        $todos = $this->db->query('SELECT * FROM todos ORDER BY position, created_at')->fetchAll();
        $checks = $this->db->query('SELECT * FROM checks ORDER BY position')->fetchAll();
        $links = $this->db->query('SELECT todo_id, tag_id FROM todo_tags')->fetchAll();
        $byTodo = [];
        foreach ($checks as $check) {
            $byTodo[$check['todo_id']][] = [
                'id' => $check['id'],
                'title' => $check['title'],
                'done' => (int) $check['done'],
                'position' => (int) $check['position'],
            ];
        }
        $tagsByTodo = [];
        foreach ($links as $link) {
            $tagsByTodo[$link['todo_id']][] = $link['tag_id'];
        }
        foreach ($todos as &$todo) {
            $todo['evening'] = (int) $todo['evening'];
            $todo['someday'] = (int) $todo['someday'];
            $todo['reminder_sent'] = (int) $todo['reminder_sent'];
            $todo['repeat_every'] = $todo['repeat_every'] !== null ? (int) $todo['repeat_every'] : null;
            $todo['position'] = (int) $todo['position'];
            $todo['checks'] = $byTodo[$todo['id']] ?? [];
            $todo['tag_ids'] = $tagsByTodo[$todo['id']] ?? [];
        }
        unset($todo);
        $projects = $this->db->query('SELECT * FROM projects ORDER BY position, title')->fetchAll();
        foreach ($projects as &$project) {
            $project['archived'] = (int) $project['archived'];
            $project['position'] = (int) $project['position'];
        }
        unset($project);
        $headings = $this->db->query('SELECT * FROM headings ORDER BY position, title')->fetchAll();
        foreach ($headings as &$heading) {
            $heading['archived'] = (int) $heading['archived'];
            $heading['position'] = (int) $heading['position'];
        }
        unset($heading);
        $areas = $this->db->query('SELECT * FROM areas ORDER BY position, title')->fetchAll();
        $tags = $this->db->query('SELECT * FROM tags ORDER BY position, title')->fetchAll();
        $calendars = $this->db->query('SELECT * FROM calendars ORDER BY title')->fetchAll();
        foreach ($calendars as &$calendar) {
            $calendar['visible'] = (int) $calendar['visible'];
        }
        unset($calendar);
        $undo = (int) $this->db->query('SELECT COUNT(*) FROM undo')->fetchColumn();
        return [
            'today' => $this->today(),
            'now' => date('Y-m-d H:i:s'),
            'areas' => $areas,
            'projects' => $projects,
            'headings' => $headings,
            'todos' => $todos,
            'tags' => $tags,
            'calendars' => $calendars,
            'events' => $this->db->query('SELECT * FROM events ORDER BY date, start_time, title')->fetchAll(),
            'can_undo' => $undo > 0,
        ];
    }

    private function migrate(): void
    {
        $this->db->exec('PRAGMA foreign_keys = ON');
        $this->db->exec(<<<'SQL'
CREATE TABLE IF NOT EXISTS areas (
  id TEXT PRIMARY KEY,
  title TEXT NOT NULL,
  position INTEGER NOT NULL
);
CREATE TABLE IF NOT EXISTS projects (
  id TEXT PRIMARY KEY,
  area_id TEXT REFERENCES areas(id) ON DELETE SET NULL,
  title TEXT NOT NULL,
  notes TEXT NOT NULL DEFAULT '',
  archived INTEGER NOT NULL DEFAULT 0,
  position INTEGER NOT NULL
);
CREATE TABLE IF NOT EXISTS headings (
  id TEXT PRIMARY KEY,
  project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  title TEXT NOT NULL,
  archived INTEGER NOT NULL DEFAULT 0,
  position INTEGER NOT NULL
);
CREATE TABLE IF NOT EXISTS todos (
  id TEXT PRIMARY KEY,
  title TEXT NOT NULL,
  notes TEXT NOT NULL DEFAULT '',
  project_id TEXT REFERENCES projects(id) ON DELETE SET NULL,
  heading_id TEXT REFERENCES headings(id) ON DELETE SET NULL,
  when_date TEXT,
  evening INTEGER NOT NULL DEFAULT 0,
  someday INTEGER NOT NULL DEFAULT 0,
  deadline TEXT,
  reminder_at TEXT,
  reminder_sent INTEGER NOT NULL DEFAULT 0,
  repeat_every INTEGER,
  repeat_unit TEXT,
  completed_at TEXT,
  trashed_at TEXT,
  position INTEGER NOT NULL,
  created_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS checks (
  id TEXT PRIMARY KEY,
  todo_id TEXT NOT NULL REFERENCES todos(id) ON DELETE CASCADE,
  title TEXT NOT NULL,
  done INTEGER NOT NULL DEFAULT 0,
  position INTEGER NOT NULL
);
CREATE TABLE IF NOT EXISTS tags (
  id TEXT PRIMARY KEY,
  title TEXT NOT NULL UNIQUE,
  position INTEGER NOT NULL
);
CREATE TABLE IF NOT EXISTS todo_tags (
  todo_id TEXT NOT NULL REFERENCES todos(id) ON DELETE CASCADE,
  tag_id TEXT NOT NULL REFERENCES tags(id) ON DELETE CASCADE,
  PRIMARY KEY (todo_id, tag_id)
);
CREATE TABLE IF NOT EXISTS calendars (
  id TEXT PRIMARY KEY,
  title TEXT NOT NULL,
  color TEXT NOT NULL,
  visible INTEGER NOT NULL DEFAULT 1
);
CREATE TABLE IF NOT EXISTS events (
  id TEXT PRIMARY KEY,
  calendar_id TEXT NOT NULL REFERENCES calendars(id) ON DELETE CASCADE,
  title TEXT NOT NULL,
  date TEXT NOT NULL,
  start_time TEXT,
  end_time TEXT,
  notes TEXT NOT NULL DEFAULT ''
);
CREATE TABLE IF NOT EXISTS undo (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  snapshot TEXT NOT NULL,
  created_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS meta (
  key TEXT PRIMARY KEY,
  value TEXT NOT NULL
);
SQL);
        $this->ensureEmojiColumns();
        $seeded = $this->db->query("SELECT value FROM meta WHERE key='seeded'")->fetchColumn();
        if (!$seeded) {
            $this->db->beginTransaction();
            $this->seed();
            $this->db->commit();
        }
        $this->backfillEmoji();
    }

    private function ensureEmojiColumns(): void
    {
        foreach (['areas', 'projects'] as $table) {
            $cols = array_column($this->db->query('PRAGMA table_info(' . $table . ')')->fetchAll(), 'name');
            if (!in_array('emoji', $cols, true)) {
                $this->db->exec('ALTER TABLE ' . $table . ' ADD COLUMN emoji TEXT');
            }
        }
    }

    private function backfillEmoji(): void
    {
        $map = [
            'areas' => ['area_personal' => 'house', 'area_work' => 'briefcase'],
            'projects' => [
                'p_rome' => 'beach-with-umbrella',
                'p_work' => 'office-building',
                'p_jen' => 'birthday-cake',
            ],
        ];
        foreach ($map as $table => $rows) {
            $stmt = $this->db->prepare('UPDATE ' . $table . " SET emoji=? WHERE id=? AND (emoji IS NULL OR emoji='')");
            foreach ($rows as $id => $emoji) {
                $stmt->execute([$emoji, $id]);
            }
        }
    }

    private function emojiOrNull(mixed $value): ?string
    {
        $value = strtolower(trim(str_replace(' ', '-', (string) $value)));
        if ($value === '' || !preg_match('/^[a-z0-9_+-]{1,80}$/', $value)) {
            return null;
        }
        return $value;
    }

    private function seed(): void
    {
        $today = $this->today();
        $tomorrow = $this->shift($today, 1, 'day');
        $yesterday = $this->shift($today, -1, 'day');
        $nextWeek = $this->shift($today, 7, 'day');
        $this->insert('areas', ['id' => 'area_personal', 'title' => 'Personal', 'emoji' => 'house', 'position' => 1]);
        $this->insert('areas', ['id' => 'area_work', 'title' => 'Work', 'emoji' => 'briefcase', 'position' => 2]);
        $this->insert('projects', [
            'id' => 'p_rome', 'area_id' => 'area_personal', 'title' => 'Vacation in Rome', 'emoji' => 'beach-with-umbrella',
            'notes' => 'Leave Friday. Pick up the maps before packing.', 'archived' => 0, 'position' => 1,
        ]);
        $this->insert('projects', [
            'id' => 'p_jen', 'area_id' => 'area_personal', 'title' => "Jen's birthday", 'emoji' => 'birthday-cake',
            'notes' => '', 'archived' => 0, 'position' => 2,
        ]);
        $this->insert('projects', [
            'id' => 'p_work', 'area_id' => 'area_work', 'title' => 'Work', 'emoji' => 'office-building',
            'notes' => '', 'archived' => 0, 'position' => 3,
        ]);
        $this->insert('headings', ['id' => 'h_before', 'project_id' => 'p_rome', 'title' => 'Before the trip', 'archived' => 0, 'position' => 1]);
        $this->insert('headings', ['id' => 'h_pack', 'project_id' => 'p_rome', 'title' => 'Packing', 'archived' => 0, 'position' => 2]);
        $this->insert('headings', ['id' => 'h_week', 'project_id' => 'p_work', 'title' => 'This week', 'archived' => 0, 'position' => 1]);
        $this->insert('tags', ['id' => 'tag_errands', 'title' => 'Errands', 'position' => 1]);
        $this->insert('tags', ['id' => 'tag_travel', 'title' => 'Travel', 'position' => 2]);
        $this->insert('tags', ['id' => 'tag_home', 'title' => 'Home', 'position' => 3]);
        $rows = [
            ['t1', "Borrow Sarah's travel guide", 'p_rome', 'h_before', $today, 0, 0, null, null, null, null, 1],
            ['t2', 'Finish expense report', 'p_work', 'h_week', $today, 0, 0, $today, null, null, null, 2],
            ['t3', 'Buy birthday cake', 'p_jen', null, $today, 0, 0, $tomorrow, null, null, null, 3],
            ['t4', 'Call dentist', null, null, null, 0, 0, null, $today . ' 17:30:00', null, null, 4],
            ['t5', 'Book train to Rome', 'p_rome', 'h_before', $tomorrow, 0, 0, null, $tomorrow . ' 09:00:00', 1, 'week', 5],
            ['t6', 'Update portfolio', 'p_work', null, null, 0, 0, null, null, null, null, 6],
            ['t7', 'Learn to make carbonara', null, null, null, 0, 1, null, null, null, null, 7],
            ['t8', 'Send party invite', 'p_jen', null, $yesterday, 0, 0, null, null, null, null, 8],
            ['t9', 'Renew travel insurance', 'p_rome', 'h_before', $yesterday, 0, 0, $today, null, null, null, 9],
            ['t10', 'Pack a day bag', 'p_rome', 'h_pack', $today, 1, 0, null, null, null, null, 10],
            ['t11', 'Weekly review', 'p_work', 'h_week', $nextWeek, 0, 0, null, null, 1, 'week', 11],
        ];
        foreach ($rows as $row) {
            $this->insert('todos', [
                'id' => $row[0], 'title' => $row[1], 'notes' => '', 'project_id' => $row[2], 'heading_id' => $row[3],
                'when_date' => $row[4], 'evening' => $row[5], 'someday' => $row[6], 'deadline' => $row[7],
                'reminder_at' => $row[8], 'reminder_sent' => 0, 'repeat_every' => $row[9], 'repeat_unit' => $row[10],
                'completed_at' => $row[0] === 't8' ? $yesterday . ' 15:00:00' : null,
                'trashed_at' => null, 'position' => $row[11], 'created_at' => $yesterday . ' 09:00:00',
            ]);
        }
        $this->insert('todo_tags', ['todo_id' => 't1', 'tag_id' => 'tag_travel']);
        $this->insert('todo_tags', ['todo_id' => 't3', 'tag_id' => 'tag_errands']);
        $this->insert('todo_tags', ['todo_id' => 't4', 'tag_id' => 'tag_errands']);
        $this->insert('todo_tags', ['todo_id' => 't10', 'tag_id' => 'tag_travel']);
        foreach ([['c1', 't10', 'Passport', 0, 1], ['c2', 't10', 'Charger', 0, 2], ['c3', 't10', 'Travel guide', 1, 3]] as $check) {
            $this->insert('checks', ['id' => $check[0], 'todo_id' => $check[1], 'title' => $check[2], 'done' => $check[3], 'position' => $check[4]]);
        }
        $this->insert('calendars', ['id' => 'cal_personal', 'title' => 'Personal', 'color' => '#e15b4c', 'visible' => 1]);
        $this->insert('calendars', ['id' => 'cal_work', 'title' => 'Work', 'color' => '#4c7dff', 'visible' => 1]);
        $this->insert('events', [
            'id' => 'e1', 'calendar_id' => 'cal_work', 'title' => 'Team standup',
            'date' => $today, 'start_time' => '09:30', 'end_time' => '09:45', 'notes' => '',
        ]);
        $this->insert('events', [
            'id' => 'e2', 'calendar_id' => 'cal_personal', 'title' => 'Dinner near the hotel',
            'date' => $tomorrow, 'start_time' => '19:30', 'end_time' => '21:00', 'notes' => '',
        ]);
        $this->db->prepare("INSERT INTO meta (key, value) VALUES ('seeded', '1')")->execute();
    }

    private function wipe(): void
    {
        $this->db->exec('PRAGMA foreign_keys = OFF');
        foreach (['todo_tags', 'checks', 'todos', 'headings', 'projects', 'areas', 'tags', 'events', 'calendars', 'undo', 'meta'] as $table) {
            $this->db->exec('DELETE FROM ' . $table);
        }
        $this->db->exec('PRAGMA foreign_keys = ON');
    }

    private function createTodo(array $body): string
    {
        $id = $this->id();
        $when = $this->dateOrNull($body['when_date'] ?? null);
        $someday = !empty($body['someday']) ? 1 : 0;
        $evening = !empty($body['evening']) ? 1 : 0;
        if ($someday) {
            $when = null;
            $evening = 0;
        }
        if ($evening && !$when) {
            $when = $this->today();
        }
        $project = $this->nullableId($body['project_id'] ?? null);
        $heading = $this->nullableId($body['heading_id'] ?? null);
        if ($heading && !$this->headingBelongs($heading, $project)) {
            $heading = null;
        }
        $this->insert('todos', [
            'id' => $id,
            'title' => trim((string) ($body['title'] ?? '')),
            'notes' => (string) ($body['notes'] ?? ''),
            'project_id' => $project,
            'heading_id' => $heading,
            'when_date' => $when,
            'evening' => $evening,
            'someday' => $someday,
            'deadline' => $this->dateOrNull($body['deadline'] ?? null),
            'reminder_at' => $this->dateTimeOrNull($body['reminder_at'] ?? null),
            'reminder_sent' => 0,
            'repeat_every' => $this->repeatEvery($body['repeat_every'] ?? null),
            'repeat_unit' => $this->repeatUnit($body['repeat_unit'] ?? null),
            'completed_at' => null,
            'trashed_at' => null,
            'position' => $this->nextPosition('todos') ,
            'created_at' => date('Y-m-d H:i:s'),
        ]);
        if (!empty($body['tag_ids']) && is_array($body['tag_ids'])) {
            $this->replaceTags($id, $body['tag_ids']);
        }
        if (!empty($body['checks']) && is_array($body['checks'])) {
            $this->replaceChecks($id, $body['checks']);
        }
        if (!empty($body['before_id'])) {
            $this->placeBefore($id, (string) $body['before_id']);
        }
        return $id;
    }

    private function updateTodo(string $id, array $fields): void
    {
        if (!$this->todo($id)) {
            throw new RuntimeException('To-do not found');
        }
        if (array_key_exists('title', $fields)) {
            $this->db->prepare('UPDATE todos SET title=? WHERE id=?')->execute([trim((string) $fields['title']), $id]);
        }
        if (array_key_exists('notes', $fields)) {
            $this->db->prepare('UPDATE todos SET notes=? WHERE id=?')->execute([(string) $fields['notes'], $id]);
        }
        $this->applyPatch($id, $fields);
        if (array_key_exists('repeat_every', $fields) || array_key_exists('repeat_unit', $fields)) {
            $every = $this->repeatEvery($fields['repeat_every'] ?? null);
            $unit = $every ? $this->repeatUnit($fields['repeat_unit'] ?? 'day') : null;
            $this->db->prepare('UPDATE todos SET repeat_every=?, repeat_unit=? WHERE id=?')->execute([$every, $unit, $id]);
        }
        if (array_key_exists('checks', $fields) && is_array($fields['checks'])) {
            $this->replaceChecks($id, $fields['checks']);
        }
        if (array_key_exists('tag_ids', $fields) && is_array($fields['tag_ids'])) {
            $this->replaceTags($id, $fields['tag_ids']);
        }
        if (!empty($fields['new_tag'])) {
            $tag = $this->findOrCreateTag((string) $fields['new_tag']);
            $this->db->prepare('INSERT OR IGNORE INTO todo_tags (todo_id, tag_id) VALUES (?, ?)')->execute([$id, $tag]);
        }
    }

    private function applyPatch(string $id, array $fields): void
    {
        $todo = $this->todo($id);
        $when = array_key_exists('when_date', $fields) ? $this->dateOrNull($fields['when_date']) : $todo['when_date'];
        $evening = array_key_exists('evening', $fields) ? (!empty($fields['evening']) ? 1 : 0) : (int) $todo['evening'];
        $someday = array_key_exists('someday', $fields) ? (!empty($fields['someday']) ? 1 : 0) : (int) $todo['someday'];
        $project = array_key_exists('project_id', $fields) ? $this->nullableId($fields['project_id']) : $todo['project_id'];
        $heading = array_key_exists('heading_id', $fields) ? $this->nullableId($fields['heading_id']) : $todo['heading_id'];
        if ($someday) {
            $when = null;
            $evening = 0;
        }
        if ($evening && !$when) {
            $when = $this->today();
        }
        if (!$this->headingBelongs($heading, $project)) {
            $heading = null;
        }
        $deadline = array_key_exists('deadline', $fields) ? $this->dateOrNull($fields['deadline']) : $todo['deadline'];
        $reminder = array_key_exists('reminder_at', $fields) ? $this->dateTimeOrNull($fields['reminder_at']) : $todo['reminder_at'];
        $sent = $reminder !== $todo['reminder_at'] ? 0 : (int) $todo['reminder_sent'];
        $this->db->prepare('UPDATE todos SET project_id=?, heading_id=?, when_date=?, evening=?, someday=?, deadline=?, reminder_at=?, reminder_sent=? WHERE id=?')
            ->execute([$project, $heading, $when, $evening, $someday, $deadline, $reminder, $sent, $id]);
    }

    private function completeTodo(string $id): void
    {
        $todo = $this->todo($id);
        if (!$todo || $todo['trashed_at'] || $todo['completed_at']) {
            return;
        }
        $this->setCompleted($id, date('Y-m-d H:i:s'));
        if (!$todo['repeat_every'] || !$todo['repeat_unit']) {
            return;
        }
        $baseWhen = $todo['when_date'] ?: $this->today();
        $nextWhen = $this->shift($baseWhen, (int) $todo['repeat_every'], (string) $todo['repeat_unit']);
        if ($nextWhen <= $this->today()) {
            $nextWhen = $this->shift($this->today(), (int) $todo['repeat_every'], (string) $todo['repeat_unit']);
        }
        $nextDeadline = $todo['deadline'] ? $this->shift($todo['deadline'], (int) $todo['repeat_every'], (string) $todo['repeat_unit']) : null;
        $nextReminder = $todo['reminder_at'] ? $this->shiftDateTime($todo['reminder_at'], (int) $todo['repeat_every'], (string) $todo['repeat_unit']) : null;
        $newId = $this->id();
        $this->insert('todos', [
            'id' => $newId,
            'title' => $todo['title'],
            'notes' => $todo['notes'],
            'project_id' => $todo['project_id'],
            'heading_id' => $todo['heading_id'],
            'when_date' => $nextWhen,
            'evening' => (int) $todo['evening'],
            'someday' => 0,
            'deadline' => $nextDeadline,
            'reminder_at' => $nextReminder,
            'reminder_sent' => 0,
            'repeat_every' => (int) $todo['repeat_every'],
            'repeat_unit' => $todo['repeat_unit'],
            'completed_at' => null,
            'trashed_at' => null,
            'position' => (int) $todo['position'],
            'created_at' => date('Y-m-d H:i:s'),
        ]);
        $tagStmt = $this->db->prepare('SELECT tag_id FROM todo_tags WHERE todo_id=?');
        $tagStmt->execute([$id]);
        foreach ($tagStmt->fetchAll() as $tag) {
            $this->insert('todo_tags', ['todo_id' => $newId, 'tag_id' => $tag['tag_id']]);
        }
        $checks = $this->db->prepare('SELECT title, position FROM checks WHERE todo_id=? ORDER BY position');
        $checks->execute([$id]);
        foreach ($checks->fetchAll() as $check) {
            $this->insert('checks', [
                'id' => $this->id(), 'todo_id' => $newId, 'title' => $check['title'], 'done' => 0, 'position' => (int) $check['position'],
            ]);
        }
    }

    private function setCompleted(string $id, ?string $at): void
    {
        $this->db->prepare('UPDATE todos SET completed_at=? WHERE id=?')->execute([$at, $id]);
    }

    private function trashTodo(string $id, bool $on): void
    {
        $this->db->prepare('UPDATE todos SET trashed_at=? WHERE id=?')->execute([$on ? date('Y-m-d H:i:s') : null, $id]);
    }

    private function reorderTodos(array $body): void
    {
        $ids = array_values(array_filter(array_map('strval', $body['ids'] ?? [])));
        $moving = array_values(array_filter(array_map('strval', $body['moving'] ?? $ids)));
        $patch = is_array($body['patch'] ?? null) ? $body['patch'] : [];
        foreach ($moving as $id) {
            if ($this->todo($id)) {
                $this->applyPatch($id, $patch);
            }
        }
        $this->rewritePositions('todos', $ids);
    }

    private function batch(array $body): void
    {
        $ids = $this->ids($body);
        $patch = is_array($body['patch'] ?? null) ? $body['patch'] : [];
        if ($patch) {
            foreach ($ids as $id) {
                $this->updateTodo($id, $patch);
            }
        }
        if (!empty($body['tag_add'])) {
            $tag = $this->findOrCreateTag((string) $body['tag_add']);
            foreach ($ids as $id) {
                $this->db->prepare('INSERT OR IGNORE INTO todo_tags (todo_id, tag_id) VALUES (?, ?)')->execute([$id, $tag]);
            }
        }
        if (!empty($body['complete'])) {
            foreach ($ids as $id) {
                $this->completeTodo($id);
            }
        }
        if (!empty($body['trash'])) {
            foreach ($ids as $id) {
                $this->trashTodo($id, true);
            }
        }
    }

    private function createHeading(array $body): string
    {
        $project = (string) ($body['project_id'] ?? '');
        if (!$this->one('SELECT id FROM projects WHERE id=?', [$project])) {
            throw new RuntimeException('List not found');
        }
        $id = $this->id();
        $this->insert('headings', [
            'id' => $id,
            'project_id' => $project,
            'title' => trim((string) ($body['title'] ?? '')) ?: 'New Heading',
            'archived' => 0,
            'position' => $this->nextPosition('headings'),
        ]);
        if (!empty($body['before_id'])) {
            $rows = $this->db->prepare('SELECT id FROM headings WHERE project_id=? ORDER BY position');
            $rows->execute([$project]);
            $ids = array_column($rows->fetchAll(), 'id');
            $ids = array_values(array_filter($ids, fn($item) => $item !== $id));
            $index = array_search((string) $body['before_id'], $ids, true);
            if ($index === false) {
                $ids[] = $id;
            } else {
                array_splice($ids, (int) $index, 0, [$id]);
            }
            $this->rewritePositions('headings', $ids);
        }
        return $id;
    }

    private function createProject(array $body): string
    {
        $id = $this->id();
        $area = $this->nullableId($body['area_id'] ?? null);
        $this->insert('projects', [
            'id' => $id,
            'area_id' => $area,
            'title' => trim((string) ($body['title'] ?? '')) ?: 'New Project',
            'emoji' => $this->emojiOrNull($body['emoji'] ?? null) ?? 'file-folder',
            'notes' => (string) ($body['notes'] ?? ''),
            'archived' => 0,
            'position' => $this->nextPosition('projects'),
        ]);
        return $id;
    }

    private function updateProject(array $body): void
    {
        $id = (string) ($body['id'] ?? '');
        if (array_key_exists('title', $body)) {
            $this->db->prepare('UPDATE projects SET title=? WHERE id=?')->execute([trim((string) $body['title']) ?: 'Untitled', $id]);
        }
        if (array_key_exists('notes', $body)) {
            $this->db->prepare('UPDATE projects SET notes=? WHERE id=?')->execute([(string) $body['notes'], $id]);
        }
        if (array_key_exists('area_id', $body)) {
            $this->db->prepare('UPDATE projects SET area_id=? WHERE id=?')->execute([$this->nullableId($body['area_id']), $id]);
        }
        if (array_key_exists('emoji', $body)) {
            $this->db->prepare('UPDATE projects SET emoji=? WHERE id=?')->execute([$this->emojiOrNull($body['emoji']), $id]);
        }
    }

    private function createEvent(array $body): string
    {
        $id = $this->id();
        $calendar = (string) ($body['calendar_id'] ?? '');
        if (!$this->one('SELECT id FROM calendars WHERE id=?', [$calendar])) {
            $calendar = (string) $this->db->query('SELECT id FROM calendars ORDER BY title LIMIT 1')->fetchColumn();
        }
        if (!$calendar) {
            $calendar = $this->id();
            $this->insert('calendars', ['id' => $calendar, 'title' => 'Personal', 'color' => '#e15b4c', 'visible' => 1]);
        }
        $this->insert('events', [
            'id' => $id,
            'calendar_id' => $calendar,
            'title' => trim((string) ($body['title'] ?? '')) ?: 'New Event',
            'date' => $this->dateOrNull($body['date'] ?? null) ?: $this->today(),
            'start_time' => $this->timeOrNull($body['start_time'] ?? null),
            'end_time' => $this->timeOrNull($body['end_time'] ?? null),
            'notes' => (string) ($body['notes'] ?? ''),
        ]);
        return $id;
    }

    private function updateEvent(array $body): void
    {
        $id = (string) ($body['id'] ?? '');
        $event = $this->one('SELECT * FROM events WHERE id=?', [$id]);
        if (!$event) {
            throw new RuntimeException('Event not found');
        }
        $this->db->prepare('UPDATE events SET title=?, date=?, start_time=?, end_time=?, notes=?, calendar_id=? WHERE id=?')->execute([
            array_key_exists('title', $body) ? (trim((string) $body['title']) ?: 'New Event') : $event['title'],
            array_key_exists('date', $body) ? ($this->dateOrNull($body['date']) ?: $event['date']) : $event['date'],
            array_key_exists('start_time', $body) ? $this->timeOrNull($body['start_time']) : $event['start_time'],
            array_key_exists('end_time', $body) ? $this->timeOrNull($body['end_time']) : $event['end_time'],
            array_key_exists('notes', $body) ? (string) $body['notes'] : $event['notes'],
            array_key_exists('calendar_id', $body) ? (string) $body['calendar_id'] : $event['calendar_id'],
            $id,
        ]);
    }

    private function dueReminders(): array
    {
        $stmt = $this->db->prepare('SELECT id, title, reminder_at FROM todos WHERE reminder_at IS NOT NULL AND reminder_at<=? AND completed_at IS NULL AND trashed_at IS NULL AND reminder_sent=0 ORDER BY reminder_at');
        $stmt->execute([date('Y-m-d H:i:s')]);
        return $stmt->fetchAll();
    }

    private function ackReminders(array $ids): void
    {
        $stmt = $this->db->prepare('UPDATE todos SET reminder_sent=1 WHERE id=?');
        foreach ($ids as $id) {
            $stmt->execute([(string) $id]);
        }
    }

    private function snapshot(): void
    {
        $data = [
            'areas' => $this->db->query('SELECT * FROM areas')->fetchAll(),
            'projects' => $this->db->query('SELECT * FROM projects')->fetchAll(),
            'headings' => $this->db->query('SELECT * FROM headings')->fetchAll(),
            'todos' => $this->db->query('SELECT * FROM todos')->fetchAll(),
            'checks' => $this->db->query('SELECT * FROM checks')->fetchAll(),
            'tags' => $this->db->query('SELECT * FROM tags')->fetchAll(),
            'todo_tags' => $this->db->query('SELECT * FROM todo_tags')->fetchAll(),
            'calendars' => $this->db->query('SELECT * FROM calendars')->fetchAll(),
            'events' => $this->db->query('SELECT * FROM events')->fetchAll(),
        ];
        $this->db->prepare('INSERT INTO undo (snapshot, created_at) VALUES (?, ?)')->execute([json_encode($data), date('c')]);
        $this->db->exec('DELETE FROM undo WHERE id NOT IN (SELECT id FROM undo ORDER BY id DESC LIMIT 40)');
    }

    private function undo(): void
    {
        $row = $this->db->query('SELECT id, snapshot FROM undo ORDER BY id DESC LIMIT 1')->fetch();
        if (!$row) {
            return;
        }
        $data = json_decode($row['snapshot'], true);
        if (!is_array($data)) {
            return;
        }
        $this->db->prepare('DELETE FROM undo WHERE id=?')->execute([$row['id']]);
        $this->restore($data);
    }

    private function restore(array $data): void
    {
        $this->db->exec('PRAGMA foreign_keys = OFF');
        foreach (['todo_tags', 'checks', 'todos', 'headings', 'projects', 'areas', 'tags', 'events', 'calendars'] as $table) {
            $this->db->exec('DELETE FROM ' . $table);
        }
        foreach (['areas', 'tags', 'calendars', 'projects', 'headings', 'todos', 'checks', 'todo_tags', 'events'] as $table) {
            foreach ($data[$table] ?? [] as $row) {
                $this->insert($table, $row);
            }
        }
        $this->db->exec('PRAGMA foreign_keys = ON');
        $this->backfillEmoji();
    }

    private function replaceChecks(string $todoId, array $checks): void
    {
        $this->db->prepare('DELETE FROM checks WHERE todo_id=?')->execute([$todoId]);
        $position = 1;
        foreach ($checks as $check) {
            $title = trim((string) ($check['title'] ?? ''));
            if ($title === '') {
                continue;
            }
            $this->insert('checks', [
                'id' => $this->safeId($check['id'] ?? null),
                'todo_id' => $todoId,
                'title' => $title,
                'done' => !empty($check['done']) ? 1 : 0,
                'position' => $position++,
            ]);
        }
    }

    private function replaceTags(string $todoId, array $tagIds): void
    {
        $this->db->prepare('DELETE FROM todo_tags WHERE todo_id=?')->execute([$todoId]);
        $stmt = $this->db->prepare('INSERT OR IGNORE INTO todo_tags (todo_id, tag_id) VALUES (?, ?)');
        foreach ($tagIds as $tagId) {
            $tagId = (string) $tagId;
            if ($this->one('SELECT id FROM tags WHERE id=?', [$tagId])) {
                $stmt->execute([$todoId, $tagId]);
            }
        }
    }

    private function findOrCreateTag(string $title): string
    {
        $title = trim($title);
        if ($title === '') {
            throw new InvalidArgumentException('Tag needs a name');
        }
        $existing = $this->one('SELECT id FROM tags WHERE lower(title)=lower(?)', [$title]);
        if ($existing) {
            return $existing['id'];
        }
        $id = $this->id();
        $this->insert('tags', ['id' => $id, 'title' => $title, 'position' => $this->nextPosition('tags')]);
        return $id;
    }

    private function placeBefore(string $id, string $beforeId): void
    {
        $before = $this->todo($beforeId);
        if (!$before) {
            return;
        }
        $this->db->prepare('UPDATE todos SET position=? WHERE id=?')->execute([(int) $before['position'] - 1, $id]);
    }

    private function rewritePositions(string $table, array $ids): void
    {
        if (!in_array($table, ['todos', 'headings', 'projects', 'areas', 'tags'], true)) {
            throw new InvalidArgumentException('Bad table');
        }
        $stmt = $this->db->prepare('UPDATE ' . $table . ' SET position=? WHERE id=?');
        $position = 1;
        foreach ($ids as $id) {
            $stmt->execute([$position++, (string) $id]);
        }
    }

    private function headingBelongs(?string $heading, ?string $project): bool
    {
        if (!$heading) {
            return false;
        }
        $row = $this->one('SELECT project_id FROM headings WHERE id=?', [$heading]);
        return $row && $row['project_id'] === $project;
    }

    private function todo(string $id): ?array
    {
        return $this->one('SELECT * FROM todos WHERE id=?', [$id]);
    }

    private function one(string $sql, array $params): ?array
    {
        $stmt = $this->db->prepare($sql);
        $stmt->execute($params);
        $row = $stmt->fetch();
        return $row ?: null;
    }

    private function ids(array $body): array
    {
        $ids = $body['ids'] ?? [];
        if (!$ids && !empty($body['id'])) {
            $ids = [$body['id']];
        }
        return array_values(array_filter(array_map('strval', is_array($ids) ? $ids : [])));
    }

    private function insert(string $table, array $row): void
    {
        $cols = array_keys($row);
        $sql = 'INSERT INTO ' . $table . ' (' . implode(',', $cols) . ') VALUES (' . implode(',', array_fill(0, count($cols), '?')) . ')';
        $this->db->prepare($sql)->execute(array_values($row));
    }

    private function nextPosition(string $table): int
    {
        return ((int) $this->db->query('SELECT COALESCE(MAX(position), 0) FROM ' . $table)->fetchColumn()) + 1;
    }

    private function id(): string
    {
        return bin2hex(random_bytes(8));
    }

    private function safeId(mixed $id): string
    {
        $id = (string) $id;
        return preg_match('/^[A-Za-z0-9_-]{4,32}$/', $id) ? $id : $this->id();
    }

    private function nullableId(mixed $id): ?string
    {
        $id = trim((string) $id);
        return $id === '' ? null : $id;
    }

    private function dateOrNull(mixed $value): ?string
    {
        $value = trim((string) $value);
        if ($value === '') {
            return null;
        }
        if (!preg_match('/^\d{4}-\d{2}-\d{2}$/', $value)) {
            throw new InvalidArgumentException('Bad date');
        }
        return $value;
    }

    private function dateTimeOrNull(mixed $value): ?string
    {
        $value = trim((string) $value);
        if ($value === '') {
            return null;
        }
        $value = str_replace('T', ' ', $value);
        if (preg_match('/^\d{4}-\d{2}-\d{2} \d{2}:\d{2}$/', $value)) {
            $value .= ':00';
        }
        if (!preg_match('/^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}$/', $value)) {
            throw new InvalidArgumentException('Bad reminder');
        }
        return $value;
    }

    private function timeOrNull(mixed $value): ?string
    {
        $value = trim((string) $value);
        if ($value === '') {
            return null;
        }
        if (!preg_match('/^\d{2}:\d{2}$/', $value)) {
            throw new InvalidArgumentException('Bad time');
        }
        return $value;
    }

    private function repeatEvery(mixed $value): ?int
    {
        if ($value === null || $value === '' || (int) $value < 1) {
            return null;
        }
        return min(99, (int) $value);
    }

    private function repeatUnit(mixed $value): ?string
    {
        $value = (string) $value;
        return in_array($value, ['day', 'week', 'month', 'year'], true) ? $value : 'day';
    }

    private function color(string $color): string
    {
        return preg_match('/^#[0-9a-fA-F]{6}$/', $color) ? $color : '#4c7dff';
    }

    private function today(): string
    {
        return date('Y-m-d');
    }

    private function shift(string $date, int $every, string $unit): string
    {
        $unit = match ($unit) {
            'day' => 'days',
            'week' => 'weeks',
            'month' => 'months',
            'year' => 'years',
            default => 'days',
        };
        $sign = $every < 0 ? '' : '+';
        return date('Y-m-d', strtotime($date . ' ' . $sign . $every . ' ' . $unit));
    }

    private function shiftDateTime(string $dateTime, int $every, string $unit): string
    {
        $date = substr($dateTime, 0, 10);
        $time = substr($dateTime, 11);
        return $this->shift($date, $every, $unit) . ' ' . $time;
    }
}
