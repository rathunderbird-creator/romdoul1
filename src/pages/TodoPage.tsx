import React, { useState, useEffect, useRef, useMemo } from 'react';
import { supabase } from '../lib/supabase';
import { useHeader } from '../context/HeaderContext';
import { useStore } from '../context/StoreContext';
import { useToast } from '../context/ToastContext';
import { CheckCircle2, Circle, Calendar as CalendarIcon, Inbox, CalendarDays, Plus, Flag, Loader2, Trash2, X, Hash, Clock, AlignLeft, Repeat, Bell } from 'lucide-react';
import { useMobile } from '../hooks/useMobile';
import { toLocalDateStr } from '../utils/todoReminders';

interface TodoProject {
    id: string;
    name: string;
    color: string;
}

type RepeatRule = 'daily' | 'weekly' | 'monthly';

interface Todo {
    id: string;
    title: string;
    description: string | null;
    due_date: string | null;
    priority: number;
    status: string;
    project_id: string | null;
    created_at: string;
    repeat_rule: RepeatRule | null;
    remind_at: string | null;        // 'HH:MM' local time
    last_reminded_on: string | null; // local YYYY-MM-DD, guards one reminder per day
}

const REPEAT_OPTIONS: Array<{ value: RepeatRule | ''; label: string }> = [
    { value: '', label: 'No repeat' },
    { value: 'daily', label: 'Daily' },
    { value: 'weekly', label: 'Weekly' },
    { value: 'monthly', label: 'Monthly' },
];

const PROJECT_COLORS = ['#EF4444', '#F97316', '#F59E0B', '#10B981', '#3B82F6', '#6366F1', '#8B5CF6', '#EC4899'];

// Advances a date string one repeat interval. Monthly clamps to the end of shorter
// months, so a task due the 31st lands on the 30th/28th rather than skipping ahead.
const advanceDate = (dateStr: string, rule: RepeatRule): string => {
    const [y, m, d] = dateStr.split('-').map(Number);
    if (rule === 'daily') return toLocalDateStr(new Date(y, m - 1, d + 1));
    if (rule === 'weekly') return toLocalDateStr(new Date(y, m - 1, d + 7));
    const lastDayOfNextMonth = new Date(y, m + 1, 0).getDate();
    return toLocalDateStr(new Date(y, m, Math.min(d, lastDayOfNextMonth)));
};

// The `todos` table column is named `project`, but the rest of this component uses
// the conventional `project_id`. Translate at the Supabase boundary so the two stay
// in sync — otherwise every insert/update 400s and rows read back with no project.
type TodoRow = Omit<Todo, 'project_id'> & { project: string | null };

const fromDbTodo = (row: TodoRow): Todo => {
    const { project, ...rest } = row;
    // Older rows store the literal string "Inbox" (rather than NULL) for unfiled
    // tasks. Left as-is it's a truthy value that matches no project id, so the task
    // disappears from both the Inbox view and every project view.
    const isUnfiled = !project || project === 'Inbox';
    return { ...rest, project_id: isUnfiled ? null : project };
};

const toDbTodo = (updates: Partial<Todo> & Record<string, unknown>): Record<string, unknown> => {
    const { project_id, ...rest } = updates;
    // Stamp every write here, at the single boundary, so no path can forget it.
    const row: Record<string, unknown> = { ...rest, updated_at: new Date().toISOString() };
    if ('project_id' in updates) row.project = project_id ?? null;
    return row;
};

// Sidebar count pill. Hidden at zero so the sidebar stays quiet when there's
// nothing to do, rather than showing a row of noisy "0"s.
const CountBadge: React.FC<{ count: number; urgent?: boolean }> = ({ count, urgent }) => {
    if (!count) return null;
    return (
        <span style={{
            marginLeft: 'auto',
            fontSize: '12px',
            fontWeight: urgent ? 700 : 500,
            color: urgent ? '#EF4444' : 'var(--color-text-secondary)',
            background: urgent ? 'rgba(239,68,68,0.12)' : 'var(--color-surface)',
            padding: '2px 8px',
            borderRadius: '12px',
            minWidth: '20px',
            textAlign: 'center'
        }}>
            {count}
        </span>
    );
};

const TodoPage: React.FC = () => {
    const { setHeaderContent } = useHeader();
    const { currentUser } = useStore();
    const { showToast } = useToast();
    const isMobile = useMobile();

    const [todos, setTodos] = useState<Todo[]>([]);
    const [projects, setProjects] = useState<TodoProject[]>([]);
    const [isLoading, setIsLoading] = useState(true);
    
    // View state
    const [activeView, setActiveView] = useState<string>('inbox');
    const [showCompleted, setShowCompleted] = useState(false);
    
    // Add task inline state
    const [isAdding, setIsAdding] = useState(false);
    const [newTaskTitle, setNewTaskTitle] = useState('');
    const [newTaskPriority, setNewTaskPriority] = useState<number>(4);
    const [newTaskDueDate, setNewTaskDueDate] = useState<string>('');
    const [newTaskProjectId, setNewTaskProjectId] = useState<string>('');
    const [newTaskRepeat, setNewTaskRepeat] = useState<RepeatRule | ''>('');
    const [newTaskRemindAt, setNewTaskRemindAt] = useState<string>('');
    const [isSubmitting, setIsSubmitting] = useState(false);
    const inputRef = useRef<HTMLInputElement>(null);

    // Edit Drawer state
    const [selectedTodo, setSelectedTodo] = useState<Todo | null>(null);

    // Debounced persistence for free-text drawer fields (title/description), so we
    // don't fire a Supabase UPDATE on every keystroke.
    const textPersistTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
    const pendingTextUpdate = useRef<{ id: string; updates: Partial<Todo> } | null>(null);

    // New Project state
    const [isAddingProject, setIsAddingProject] = useState(false);
    const [newProjectName, setNewProjectName] = useState('');
    const [newProjectColor, setNewProjectColor] = useState(PROJECT_COLORS[6]);

    useEffect(() => {
        setHeaderContent({
            title: (
                <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                    <CheckCircle2 size={20} color="#8B5CF6" />
                    <h1 style={{ fontSize: '18px', fontWeight: 'bold' }}>Todo</h1>
                </div>
            )
        });
        return () => setHeaderContent(null);
    }, [setHeaderContent]);

    useEffect(() => {
        fetchData();
    }, []);

    useEffect(() => {
        if (isAdding && inputRef.current) {
            inputRef.current.focus();
        }
    }, [isAdding]);

    const fetchData = async () => {
        setIsLoading(true);
        try {
            const [todosRes, projectsRes] = await Promise.all([
                supabase.from('todos').select('*').order('priority', { ascending: true }).order('created_at', { ascending: false }),
                supabase.from('todo_projects').select('*').order('created_at', { ascending: true })
            ]);

            if (todosRes.error) throw todosRes.error;
            if (projectsRes.error) throw projectsRes.error;

            setTodos((todosRes.data || []).map(fromDbTodo));
            setProjects(projectsRes.data || []);
        } catch (error) {
            console.error('Error fetching data:', error);
        } finally {
            setIsLoading(false);
        }
    };

    // Ask for desktop-notification permission once, the first time the user has a
    // task with a reminder set. Prompting on mount regardless would be rude.
    useEffect(() => {
        if (!('Notification' in window)) return;
        if (Notification.permission !== 'default') return;
        if (!todos.some(t => t.remind_at && t.status === 'open')) return;
        Notification.requestPermission().catch(() => { /* user dismissed */ });
    }, [todos]);

    // Firing reminders lives in <TodoReminderService />, mounted app-wide, so it keeps
    // working when this page isn't open. This page only edits the schedule.

    const handleAddProject = async (e: React.FormEvent) => {
        e.preventDefault();
        if (!newProjectName.trim()) return;

        try {
            const { data, error } = await supabase.from('todo_projects').insert([{
                name: newProjectName.trim(),
                color: newProjectColor,
                user_id: currentUser?.id
            }]).select().single();
            
            if (error) throw error;
            if (data) {
                setProjects([...projects, data]);
                setNewProjectName('');
                setIsAddingProject(false);
            }
        } catch (error) {
            console.error('Error adding project:', error);
            alert(`Failed to create project: ${error instanceof Error ? error.message : 'Check console for details.'}`);
        }
    };

    const handleAddTask = async (e: React.FormEvent) => {
        e.preventDefault();
        if (!newTaskTitle.trim()) return;

        setIsSubmitting(true);
        try {
            let defaultDate = newTaskDueDate || null;
            if (!defaultDate && activeView === 'today') {
                const today = new Date();
                defaultDate = `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, '0')}-${String(today.getDate()).padStart(2, '0')}`;
            }

            let defaultProject = newTaskProjectId || null;
            if (!defaultProject && activeView !== 'inbox' && activeView !== 'today' && activeView !== 'upcoming') {
                defaultProject = activeView;
            }

            const newTask = {
                title: newTaskTitle.trim(),
                priority: newTaskPriority,
                status: 'open',
                due_date: defaultDate,
                project_id: defaultProject,
                user_id: currentUser?.id,
                repeat_rule: newTaskRepeat || null,
                remind_at: newTaskRemindAt || null,
                last_reminded_on: null
            };

            const { data, error } = await supabase.from('todos').insert([toDbTodo(newTask)]).select().single();
            if (error) throw error;

            if (data) {
                setTodos([fromDbTodo(data), ...todos].sort((a, b) => a.priority - b.priority));
            }
            
            setNewTaskTitle('');
            setNewTaskPriority(4);
            setNewTaskDueDate('');
            setNewTaskProjectId('');
            setNewTaskRepeat('');
            setNewTaskRemindAt('');
            setIsAdding(false);
        } catch (error) {
            console.error('Error adding task:', error);
            alert(`Failed to add task: ${error instanceof Error ? error.message : 'Check console for details.'}`);
        } finally {
            setIsSubmitting(false);
        }
    };

    const toggleTodoStatus = async (id: string, currentStatus: string) => {
        const todo = todos.find(t => t.id === id);

        // Completing a repeating task rolls it to its next occurrence and leaves it
        // open, rather than closing it out — otherwise the series ends on first tick.
        if (todo?.repeat_rule && currentStatus === 'open') {
            const base = todo.due_date || toLocalDateStr(new Date());
            let next = advanceDate(base, todo.repeat_rule);
            // If the task was overdue, skip past any occurrences already missed so the
            // next due date is genuinely in the future.
            const today = toLocalDateStr(new Date());
            while (next <= today) next = advanceDate(next, todo.repeat_rule);

            const updates = { due_date: next, last_reminded_on: null };
            setTodos(prev => prev.map(t => t.id === id ? { ...t, ...updates } : t));
            setSelectedTodo(prev => (prev && prev.id === id ? { ...prev, ...updates } : prev));
            showToast(`Repeats next on ${next}`, 'success');
            try {
                await supabase.from('todos').update(toDbTodo(updates)).eq('id', id);
            } catch (error) {
                console.error('Error advancing repeating task:', error);
                fetchData();
            }
            return;
        }

        const newStatus = currentStatus === 'open' ? 'completed' : 'open';
        setTodos(prev => prev.map(t => t.id === id ? { ...t, status: newStatus } : t));
        try {
            await supabase.from('todos').update({ status: newStatus }).eq('id', id);
        } catch (error) {
            console.error('Error toggling status:', error);
            setTodos(prev => prev.map(t => t.id === id ? { ...t, status: currentStatus } : t));
        }
    };

    const updateTodo = async (id: string, updates: Partial<Todo>) => {
        setTodos(prev => prev.map(t => t.id === id ? { ...t, ...updates } : t));
        if (selectedTodo && selectedTodo.id === id) {
            setSelectedTodo({ ...selectedTodo, ...updates });
        }
        try {
            await supabase.from('todos').update(toDbTodo(updates)).eq('id', id);
        } catch (error) {
            console.error('Error updating task:', error);
            fetchData();
        }
    };

    // Persist whatever free-text edit is currently pending, immediately.
    const flushTextUpdate = () => {
        if (textPersistTimer.current) {
            clearTimeout(textPersistTimer.current);
            textPersistTimer.current = null;
        }
        const pending = pendingTextUpdate.current;
        pendingTextUpdate.current = null;
        if (pending) {
            supabase.from('todos').update(toDbTodo(pending.updates)).eq('id', pending.id)
                .then(({ error }) => { if (error) { console.error('Error saving task text:', error); fetchData(); } });
        }
    };

    // Free-text fields: reflect the change locally at once (responsive typing),
    // but coalesce the DB write onto a debounce.
    const updateTodoText = (id: string, updates: Partial<Todo>) => {
        setTodos(prev => prev.map(t => t.id === id ? { ...t, ...updates } : t));
        setSelectedTodo(prev => (prev && prev.id === id ? { ...prev, ...updates } : prev));
        pendingTextUpdate.current = {
            id,
            updates: { ...(pendingTextUpdate.current?.id === id ? pendingTextUpdate.current.updates : {}), ...updates },
        };
        if (textPersistTimer.current) clearTimeout(textPersistTimer.current);
        textPersistTimer.current = setTimeout(flushTextUpdate, 600);
    };

    // Don't lose an in-flight edit if the page unmounts before the debounce fires.
    // Held in a ref so the unmount cleanup always sees the latest closure without
    // re-running on every render.
    const flushRef = useRef(flushTextUpdate);
    useEffect(() => {
        flushRef.current = flushTextUpdate;
    });
    useEffect(() => () => flushRef.current(), []);

    const deleteTodo = async (id: string) => {
        if (!confirm('Delete this task?')) return;
        if (selectedTodo?.id === id) setSelectedTodo(null);

        // Drop any pending debounced edit for this task so it can't resurrect it.
        if (pendingTextUpdate.current?.id === id) {
            if (textPersistTimer.current) clearTimeout(textPersistTimer.current);
            pendingTextUpdate.current = null;
        }

        setTodos(prev => prev.filter(t => t.id !== id));
        try {
            await supabase.from('todos').delete().eq('id', id);
        } catch (error) {
            console.error('Error deleting task:', error);
            fetchData();
        }
    };
    
    const deleteProject = async (id: string) => {
        if (!confirm('Delete this project? Tasks inside will be moved to Inbox.')) return;
        try {
            await supabase.from('todos').update({ project: null }).eq('project', id);
            await supabase.from('todo_projects').delete().eq('id', id);
            if (activeView === id) setActiveView('inbox');
            fetchData();
        } catch (error) {
            console.error('Error deleting project:', error);
        }
    };

    const getPriorityColor = (priority: number) => {
        switch (priority) {
            case 1: return '#EF4444'; 
            case 2: return '#F59E0B'; 
            case 3: return '#3B82F6'; 
            default: return 'var(--color-text-secondary)'; 
        }
    };

    const getProjectName = (projectId: string | null) => {
        if (!projectId) return 'Inbox';
        return projects.find(p => p.id === projectId)?.name || 'Inbox';
    };

    const todayStr = toLocalDateStr(new Date());

    // One predicate drives both the visible list and the sidebar counts, so a badge
    // can never disagree with what the view actually shows.
    const matchesView = (todo: Todo, view: string) => {
        switch (view) {
            case 'today':
                // Overdue tasks belong in Today too. Previously `due_date === todayStr`
                // dropped them from every date view, so a missed task was only findable
                // by browsing its project — exactly the task you least want to lose.
                return (!!todo.due_date && todo.due_date <= todayStr)
                    || (!todo.due_date && toLocalDateStr(new Date(todo.created_at)) === todayStr);
            case 'upcoming':
                return !!todo.due_date && todo.due_date > todayStr;
            case 'inbox':
                return !todo.project_id;
            default:
                return todo.project_id === view;
        }
    };

    const filterTodos = () => {
        const filtered = showCompleted ? todos : todos.filter(t => t.status === 'open');
        return filtered
            .filter(t => matchesView(t, activeView))
            // Soonest first so overdue and due-today float to the top; undated tasks
            // sink to the bottom. Priority breaks ties.
            .sort((a, b) => {
                const dateA = a.due_date || '9999-12-31';
                const dateB = b.due_date || '9999-12-31';
                if (dateA !== dateB) return dateA < dateB ? -1 : 1;
                return a.priority - b.priority;
            });
    };

    const displayedTodos = filterTodos();

    // Open-task counts per sidebar entry, plus how many of those are overdue.
    const viewCounts = useMemo(() => {
        const open = todos.filter(t => t.status === 'open');
        const counts: Record<string, number> = {
            inbox: open.filter(t => matchesView(t, 'inbox')).length,
            today: open.filter(t => matchesView(t, 'today')).length,
            upcoming: open.filter(t => matchesView(t, 'upcoming')).length,
        };
        for (const p of projects) {
            counts[p.id] = open.filter(t => matchesView(t, p.id)).length;
        }
        return counts;
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [todos, projects, todayStr]);

    const overdueCount = todos.filter(
        t => t.status === 'open' && t.due_date && t.due_date < todayStr
    ).length;

    const getViewTitle = () => {
        switch (activeView) {
            case 'today': return 'Today';
            case 'upcoming': return 'Upcoming';
            case 'inbox': return 'Inbox';
            default: {
                const proj = projects.find(p => p.id === activeView);
                return proj ? proj.name : 'Inbox';
            }
        }
    };

    const TaskItem = ({ todo }: { todo: Todo }) => {
        const isOverdue = todo.due_date && todo.due_date < todayStr && todo.status === 'open';
        const isCompleted = todo.status === 'completed';
        
        return (
            <div 
                className="glass-panel" 
                onClick={() => setSelectedTodo(todo)}
                style={{ 
                    padding: '12px 16px', borderRadius: '12px', display: 'flex', alignItems: 'flex-start', gap: '12px',
                    border: `1px solid ${selectedTodo?.id === todo.id ? '#8B5CF6' : 'var(--color-border)'}`, 
                    cursor: 'pointer', transition: 'all 0.2s',
                    boxShadow: selectedTodo?.id === todo.id ? '0 0 0 1px #8B5CF6' : '0 2px 5px rgba(0,0,0,0.02)',
                    opacity: isCompleted ? 0.6 : 1
                }}
            >
                <button 
                    onClick={(e) => { e.stopPropagation(); toggleTodoStatus(todo.id, todo.status); }}
                    style={{ 
                        background: 'none', border: 'none', cursor: 'pointer', padding: '4px',
                        display: 'flex', alignItems: 'center', justifyContent: 'center',
                        color: isCompleted ? '#10B981' : getPriorityColor(todo.priority)
                    }}
                >
                    {isCompleted ? <CheckCircle2 size={20} /> : <Circle size={20} style={{ opacity: 0.7 }} />}
                </button>
                
                <div style={{ flex: 1, display: 'flex', flexDirection: 'column', gap: '4px', paddingTop: '4px', minWidth: 0 }}>
                    <span style={{ 
                        fontSize: '15px', fontWeight: 500, color: 'var(--color-text-main)', 
                        textDecoration: isCompleted ? 'line-through' : 'none' 
                    }}>
                        {todo.title}
                    </span>
                    {todo.description && (
                        <span style={{ fontSize: '13px', color: 'var(--color-text-secondary)', display: '-webkit-box', WebkitLineClamp: 1, WebkitBoxOrient: 'vertical', overflow: 'hidden' }}>
                            {todo.description}
                        </span>
                    )}
                    <div style={{ display: 'flex', gap: '12px', marginTop: '4px', fontSize: '12px' }}>
                        {todo.due_date && (
                            <span style={{ display: 'flex', alignItems: 'center', gap: '4px', color: isOverdue ? '#EF4444' : 'var(--color-text-secondary)' }}>
                                <CalendarIcon size={12} /> {todo.due_date}
                            </span>
                        )}
                        {todo.project_id && activeView !== todo.project_id && (
                            <span style={{ display: 'flex', alignItems: 'center', gap: '4px', color: 'var(--color-text-secondary)' }}>
                                <Hash size={12} /> {getProjectName(todo.project_id)}
                            </span>
                        )}
                        {todo.repeat_rule && (
                            <span style={{ display: 'flex', alignItems: 'center', gap: '4px', color: '#8B5CF6' }}>
                                <Repeat size={12} /> {todo.repeat_rule}
                            </span>
                        )}
                        {todo.remind_at && (
                            <span style={{ display: 'flex', alignItems: 'center', gap: '4px', color: '#8B5CF6' }}>
                                <Bell size={12} /> {todo.remind_at}
                            </span>
                        )}
                    </div>
                </div>
            </div>
        );
    };

    return (
        <div style={{ display: 'flex', height: 'calc(100vh - 60px)', overflow: 'hidden', position: 'relative' }}>
            {/* Left Sidebar */}
            <div className="glass-panel" style={{ 
                width: isMobile ? '60px' : '260px', 
                borderRight: '1px solid var(--color-border)',
                padding: '20px 12px',
                display: 'flex',
                flexDirection: 'column',
                gap: '8px',
                overflowY: 'auto'
            }}>
                <button 
                    onClick={() => setActiveView('inbox')}
                    className="menu-item hover-lift"
                    style={{ 
                        display: 'flex', alignItems: 'center', gap: '12px', padding: '10px 12px', 
                        borderRadius: '8px', border: 'none', background: activeView === 'inbox' ? 'rgba(139,92,246,0.1)' : 'transparent',
                        color: activeView === 'inbox' ? '#8B5CF6' : 'var(--color-text-main)',
                        cursor: 'pointer', textAlign: 'left', fontWeight: activeView === 'inbox' ? 600 : 500
                    }}
                >
                    <Inbox size={20} color={activeView === 'inbox' ? '#8B5CF6' : '#3B82F6'} />
                    {!isMobile && <span>Inbox</span>}
                    {!isMobile && <CountBadge count={viewCounts.inbox} />}
                </button>
                <button 
                    onClick={() => setActiveView('today')}
                    className="menu-item hover-lift"
                    style={{ 
                        display: 'flex', alignItems: 'center', gap: '12px', padding: '10px 12px', 
                        borderRadius: '8px', border: 'none', background: activeView === 'today' ? 'rgba(139,92,246,0.1)' : 'transparent',
                        color: activeView === 'today' ? '#8B5CF6' : 'var(--color-text-main)',
                        cursor: 'pointer', textAlign: 'left', fontWeight: activeView === 'today' ? 600 : 500
                    }}
                >
                    <CalendarIcon size={20} color={activeView === 'today' ? '#8B5CF6' : '#10B981'} />
                    {!isMobile && <span>Today</span>}
                    {/* Overdue is called out in red — it's the number that needs acting on. */}
                    {!isMobile && <CountBadge count={viewCounts.today} urgent={overdueCount > 0} />}
                </button>
                <button 
                    onClick={() => setActiveView('upcoming')}
                    className="menu-item hover-lift"
                    style={{ 
                        display: 'flex', alignItems: 'center', gap: '12px', padding: '10px 12px', 
                        borderRadius: '8px', border: 'none', background: activeView === 'upcoming' ? 'rgba(139,92,246,0.1)' : 'transparent',
                        color: activeView === 'upcoming' ? '#8B5CF6' : 'var(--color-text-main)',
                        cursor: 'pointer', textAlign: 'left', fontWeight: activeView === 'upcoming' ? 600 : 500
                    }}
                >
                    <CalendarDays size={20} color={activeView === 'upcoming' ? '#8B5CF6' : '#F59E0B'} />
                    {!isMobile && <span>Upcoming</span>}
                    {!isMobile && <CountBadge count={viewCounts.upcoming} />}
                </button>

                {!isMobile && (
                    <div style={{ marginTop: '20px' }}>
                        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '0 12px', marginBottom: '8px' }}>
                            <span style={{ fontSize: '12px', fontWeight: 700, color: 'var(--color-text-secondary)', textTransform: 'uppercase' }}>Projects</span>
                            <button onClick={() => setIsAddingProject(!isAddingProject)} style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'var(--color-text-secondary)' }}><Plus size={16} /></button>
                        </div>
                        
                        {isAddingProject && (
                            <form onSubmit={handleAddProject} style={{ padding: '8px 12px', display: 'flex', flexDirection: 'column', gap: '8px' }}>
                                <input 
                                    autoFocus
                                    type="text" 
                                    placeholder="Project name"
                                    value={newProjectName}
                                    onChange={e => setNewProjectName(e.target.value)}
                                    style={{ padding: '6px 8px', borderRadius: '6px', border: '1px solid var(--color-border)', background: 'var(--color-surface)', color: 'var(--color-text-main)', fontSize: '13px' }}
                                />
                                <div style={{ display: 'flex', gap: '4px', flexWrap: 'wrap' }}>
                                    {PROJECT_COLORS.map(c => (
                                        <button 
                                            key={c} type="button" 
                                            onClick={() => setNewProjectColor(c)}
                                            style={{ width: '16px', height: '16px', borderRadius: '50%', background: c, border: newProjectColor === c ? '2px solid var(--color-text-main)' : 'none', cursor: 'pointer' }}
                                        />
                                    ))}
                                </div>
                                <div style={{ display: 'flex', gap: '4px' }}>
                                    <button type="submit" style={{ flex: 1, padding: '4px', background: '#8B5CF6', color: 'white', border: 'none', borderRadius: '4px', fontSize: '12px', cursor: 'pointer' }}>Add</button>
                                    <button type="button" onClick={() => setIsAddingProject(false)} style={{ flex: 1, padding: '4px', background: 'var(--color-surface)', color: 'var(--color-text-main)', border: '1px solid var(--color-border)', borderRadius: '4px', fontSize: '12px', cursor: 'pointer' }}>Cancel</button>
                                </div>
                            </form>
                        )}

                        <div style={{ display: 'flex', flexDirection: 'column', gap: '2px' }}>
                            {projects.map(p => (
                                <div key={p.id} className="menu-item hover-lift" style={{ display: 'flex', alignItems: 'center', background: activeView === p.id ? 'rgba(139,92,246,0.1)' : 'transparent', borderRadius: '8px' }}>
                                    <button 
                                        onClick={() => setActiveView(p.id)}
                                        style={{ 
                                            flex: 1, display: 'flex', alignItems: 'center', gap: '12px', padding: '8px 12px', 
                                            border: 'none', background: 'transparent',
                                            color: activeView === p.id ? '#8B5CF6' : 'var(--color-text-main)',
                                            cursor: 'pointer', textAlign: 'left', fontWeight: activeView === p.id ? 600 : 400
                                        }}
                                    >
                                        <Hash size={16} color={p.color} />
                                        <span style={{ fontSize: '14px', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{p.name}</span>
                                        <CountBadge count={viewCounts[p.id] || 0} />
                                    </button>
                                    <button onClick={() => deleteProject(p.id)} style={{ padding: '8px', background: 'none', border: 'none', cursor: 'pointer', opacity: 0.5 }} title="Delete Project">
                                        <Trash2 size={14} color="var(--color-text-secondary)" />
                                    </button>
                                </div>
                            ))}
                        </div>
                    </div>
                )}
            </div>

            {/* Main Content Area */}
            <div style={{ flex: 1, padding: isMobile ? '20px' : '40px 60px', overflowY: 'auto' }}>
                <div style={{ maxWidth: '800px', margin: '0 auto' }}>
                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '24px' }}>
                        <h2 style={{ fontSize: '28px', fontWeight: 800, color: 'var(--color-text-main)', display: 'flex', alignItems: 'center', gap: '12px' }}>
                            {getViewTitle()}
                        </h2>
                        <button 
                            onClick={() => setShowCompleted(!showCompleted)}
                            style={{ background: 'none', border: 'none', color: 'var(--color-text-secondary)', cursor: 'pointer', fontSize: '13px', display: 'flex', alignItems: 'center', gap: '6px' }}
                        >
                            <CheckCircle2 size={16} />
                            {showCompleted ? 'Hide Completed' : 'Show Completed'}
                        </button>
                    </div>

                    {isLoading ? (
                        <div style={{ display: 'flex', justifyContent: 'center', padding: '40px' }}>
                            <Loader2 size={32} style={{ animation: 'spin 1s linear infinite', color: '#8B5CF6' }} />
                        </div>
                    ) : (
                        <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
                            {displayedTodos.map(todo => <TaskItem key={todo.id} todo={todo} />)}

                            {displayedTodos.length === 0 && !isAdding && (
                                <div style={{ padding: '40px 20px', textAlign: 'center', color: 'var(--color-text-secondary)', display: 'flex', flexDirection: 'column', alignItems: 'center', gap: '12px' }}>
                                    <CheckCircle2 size={48} color="rgba(139,92,246,0.2)" />
                                    <p style={{ margin: 0, fontSize: '16px' }}>All clear! Enjoy your day.</p>
                                </div>
                            )}

                            {/* Inline Add Task */}
                            {isAdding ? (
                                <form onSubmit={handleAddTask} className="glass-panel" style={{ 
                                    padding: '16px', borderRadius: '12px', border: '1px solid #8B5CF6',
                                    display: 'flex', flexDirection: 'column', gap: '12px', marginTop: '8px',
                                    boxShadow: '0 0 0 2px rgba(139,92,246,0.2)'
                                }}>
                                    <input 
                                        ref={inputRef}
                                        type="text" 
                                        placeholder="Task name" 
                                        value={newTaskTitle}
                                        onChange={e => setNewTaskTitle(e.target.value)}
                                        style={{ border: 'none', background: 'transparent', outline: 'none', fontSize: '15px', fontWeight: 500, color: 'var(--color-text-main)', width: '100%' }}
                                        disabled={isSubmitting}
                                    />
                                    
                                    <div style={{ display: 'flex', gap: '8px', flexWrap: 'wrap' }}>
                                        {/* Priority */}
                                        <div style={{ display: 'flex', gap: '4px', background: 'var(--color-surface)', padding: '2px', borderRadius: '8px', border: '1px solid var(--color-border)' }}>
                                            {[1, 2, 3, 4].map(p => (
                                                <button
                                                    key={p} type="button" onClick={() => setNewTaskPriority(p)}
                                                    style={{ 
                                                        background: newTaskPriority === p ? `${getPriorityColor(p)}20` : 'transparent',
                                                        border: 'none', padding: '6px 8px', borderRadius: '6px', cursor: 'pointer',
                                                        display: 'flex', alignItems: 'center', gap: '4px'
                                                    }}
                                                >
                                                    <Flag size={14} color={getPriorityColor(p)} />
                                                </button>
                                            ))}
                                        </div>
                                        
                                        {/* Date Picker */}
                                        <div style={{ display: 'flex', alignItems: 'center', gap: '6px', background: 'var(--color-surface)', padding: '2px 8px', borderRadius: '8px', border: '1px solid var(--color-border)' }}>
                                            <CalendarIcon size={14} color="var(--color-text-secondary)" />
                                            <input 
                                                type="date" 
                                                value={newTaskDueDate} 
                                                onChange={e => setNewTaskDueDate(e.target.value)}
                                                style={{ border: 'none', background: 'transparent', color: 'var(--color-text-main)', outline: 'none', fontSize: '13px', cursor: 'pointer' }}
                                            />
                                        </div>

                                        {/* Project Selector */}
                                        <div style={{ display: 'flex', alignItems: 'center', gap: '6px', background: 'var(--color-surface)', padding: '2px 8px', borderRadius: '8px', border: '1px solid var(--color-border)' }}>
                                            <Hash size={14} color="var(--color-text-secondary)" />
                                            <select 
                                                value={newTaskProjectId} 
                                                onChange={e => setNewTaskProjectId(e.target.value)}
                                                style={{ border: 'none', background: 'transparent', color: 'var(--color-text-main)', outline: 'none', fontSize: '13px', cursor: 'pointer' }}
                                            >
                                                <option value="">Inbox</option>
                                                {projects.map(p => <option key={p.id} value={p.id}>{p.name}</option>)}
                                            </select>
                                        </div>

                                        {/* Repeat */}
                                        <div style={{ display: 'flex', alignItems: 'center', gap: '6px', background: 'var(--color-surface)', padding: '2px 8px', borderRadius: '8px', border: '1px solid var(--color-border)' }}>
                                            <Repeat size={14} color={newTaskRepeat ? '#8B5CF6' : 'var(--color-text-secondary)'} />
                                            <select
                                                value={newTaskRepeat}
                                                onChange={e => setNewTaskRepeat(e.target.value as RepeatRule | '')}
                                                style={{ border: 'none', background: 'transparent', color: 'var(--color-text-main)', outline: 'none', fontSize: '13px', cursor: 'pointer' }}
                                            >
                                                {REPEAT_OPTIONS.map(o => <option key={o.value} value={o.value}>{o.label}</option>)}
                                            </select>
                                        </div>

                                        {/* Reminder time */}
                                        <div style={{ display: 'flex', alignItems: 'center', gap: '6px', background: 'var(--color-surface)', padding: '2px 8px', borderRadius: '8px', border: '1px solid var(--color-border)' }}>
                                            <Bell size={14} color={newTaskRemindAt ? '#8B5CF6' : 'var(--color-text-secondary)'} />
                                            <input
                                                type="time"
                                                value={newTaskRemindAt}
                                                onChange={e => setNewTaskRemindAt(e.target.value)}
                                                title="Remind me at"
                                                style={{ border: 'none', background: 'transparent', color: 'var(--color-text-main)', outline: 'none', fontSize: '13px', cursor: 'pointer' }}
                                            />
                                        </div>
                                    </div>

                                    <div style={{ display: 'flex', justifyContent: 'flex-end', gap: '8px', borderTop: '1px solid var(--color-border)', paddingTop: '12px' }}>
                                        <button type="button" onClick={() => { setIsAdding(false); setNewTaskTitle(''); }} className="secondary-button" disabled={isSubmitting}>Cancel</button>
                                        <button type="submit" className="primary-button" disabled={!newTaskTitle.trim() || isSubmitting}>
                                            {isSubmitting ? <Loader2 size={16} style={{ animation: 'spin 1s linear infinite' }} /> : 'Add task'}
                                        </button>
                                    </div>
                                </form>
                            ) : (
                                <button 
                                    onClick={() => setIsAdding(true)}
                                    style={{ 
                                        display: 'flex', alignItems: 'center', gap: '12px', padding: '12px 16px',
                                        background: 'transparent', border: 'none', cursor: 'pointer', color: 'var(--color-text-secondary)',
                                        fontSize: '15px', marginTop: '8px', transition: 'color 0.2s'
                                    }}
                                    onMouseEnter={e => e.currentTarget.style.color = '#8B5CF6'}
                                    onMouseLeave={e => e.currentTarget.style.color = 'var(--color-text-secondary)'}
                                >
                                    <Plus size={20} color="currentColor" />
                                    Add task
                                </button>
                            )}
                        </div>
                    )}
                </div>
            </div>

            {/* Task Edit Side Drawer */}
            {selectedTodo && (
                <div style={{
                    // On desktop the drawer is a flex sibling, so the list shrinks to sit
                    // beside it. Absolutely positioning it (as before) floated it over the
                    // list and hid the right-hand side of every task. On mobile there's no
                    // room to share, so it stays a full-screen overlay.
                    ...(isMobile
                        ? { position: 'absolute' as const, right: 0, top: 0, bottom: 0, width: '100%', zIndex: 50 }
                        : { position: 'relative' as const, width: '400px', flexShrink: 0 }),
                    background: 'var(--color-background)',
                    borderLeft: '1px solid var(--color-border)',
                    boxShadow: '-4px 0 20px rgba(0,0,0,0.1)',
                    display: 'flex', flexDirection: 'column',
                    animation: 'slideInRight 0.2s ease-out'
                }}>
                    <style>{`@keyframes slideInRight { from { transform: translateX(100%); } to { transform: translateX(0); } }`}</style>
                    
                    {/* Drawer Header */}
                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '16px 20px', borderBottom: '1px solid var(--color-border)' }}>
                        <div style={{ display: 'flex', alignItems: 'center', gap: '12px' }}>
                            <select 
                                value={selectedTodo.project_id || ''}
                                onChange={e => updateTodo(selectedTodo.id, { project_id: e.target.value || null })}
                                style={{ background: 'var(--color-surface)', border: '1px solid var(--color-border)', borderRadius: '6px', padding: '4px 8px', fontSize: '13px', color: 'var(--color-text-main)', cursor: 'pointer' }}
                            >
                                <option value="">Inbox</option>
                                {projects.map(p => <option key={p.id} value={p.id}>{p.name}</option>)}
                            </select>
                        </div>
                        <div style={{ display: 'flex', gap: '8px' }}>
                            <button onClick={() => deleteTodo(selectedTodo.id)} style={{ background: 'none', border: 'none', cursor: 'pointer', padding: '8px', borderRadius: '6px' }} className="hover-lift">
                                <Trash2 size={18} color="#EF4444" />
                            </button>
                            <button onClick={() => { flushTextUpdate(); setSelectedTodo(null); }} style={{ background: 'none', border: 'none', cursor: 'pointer', padding: '8px', borderRadius: '6px' }} className="hover-lift">
                                <X size={20} color="var(--color-text-secondary)" />
                            </button>
                        </div>
                    </div>

                    {/* Drawer Body */}
                    <div style={{ padding: '24px 20px', flex: 1, overflowY: 'auto', display: 'flex', flexDirection: 'column', gap: '24px' }}>
                        {/* Title */}
                        <div>
                            <input 
                                type="text" 
                                value={selectedTodo.title}
                                onChange={e => updateTodoText(selectedTodo.id, { title: e.target.value })}
                                style={{ 
                                    width: '100%', fontSize: '20px', fontWeight: 700, color: 'var(--color-text-main)', 
                                    border: '1px solid transparent', background: 'transparent', outline: 'none',
                                    padding: '8px', borderRadius: '8px', transition: 'all 0.2s'
                                }}
                                onFocus={e => { e.target.style.background = 'var(--color-surface)'; e.target.style.borderColor = 'var(--color-border)'; }}
                                onBlur={e => { e.target.style.background = 'transparent'; e.target.style.borderColor = 'transparent'; }}
                            />
                        </div>

                        {/* Description */}
                        <div>
                            <div style={{ display: 'flex', alignItems: 'center', gap: '8px', color: 'var(--color-text-secondary)', marginBottom: '8px', fontSize: '13px', fontWeight: 600 }}>
                                <AlignLeft size={16} /> Description
                            </div>
                            <textarea 
                                value={selectedTodo.description || ''}
                                onChange={e => updateTodoText(selectedTodo.id, { description: e.target.value })}
                                placeholder="Add detailed notes or descriptions here..."
                                style={{ 
                                    width: '100%', minHeight: '120px', fontSize: '14px', color: 'var(--color-text-main)',
                                    background: 'var(--color-surface)', border: '1px solid var(--color-border)', 
                                    borderRadius: '8px', padding: '12px', outline: 'none', resize: 'vertical'
                                }}
                                onFocus={e => { e.target.style.borderColor = '#8B5CF6'; }}
                                onBlur={e => { e.target.style.borderColor = 'var(--color-border)'; }}
                            />
                        </div>

                        {/* Properties Grid */}
                        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '16px' }}>
                            {/* Due Date */}
                            <div>
                                <div style={{ display: 'flex', alignItems: 'center', gap: '8px', color: 'var(--color-text-secondary)', marginBottom: '8px', fontSize: '13px', fontWeight: 600 }}>
                                    <Clock size={16} /> Due Date
                                </div>
                                <input 
                                    type="date"
                                    value={selectedTodo.due_date || ''}
                                    onChange={e => updateTodo(selectedTodo.id, { due_date: e.target.value || null })}
                                    style={{ 
                                        width: '100%', padding: '10px 12px', borderRadius: '8px', 
                                        border: '1px solid var(--color-border)', background: 'var(--color-surface)',
                                        color: 'var(--color-text-main)', outline: 'none', cursor: 'pointer'
                                    }}
                                />
                            </div>

                            {/* Priority */}
                            <div>
                                <div style={{ display: 'flex', alignItems: 'center', gap: '8px', color: 'var(--color-text-secondary)', marginBottom: '8px', fontSize: '13px', fontWeight: 600 }}>
                                    <Flag size={16} /> Priority
                                </div>
                                <select
                                    value={selectedTodo.priority}
                                    onChange={e => updateTodo(selectedTodo.id, { priority: Number(e.target.value) })}
                                    style={{ 
                                        width: '100%', padding: '10px 12px', borderRadius: '8px', 
                                        border: '1px solid var(--color-border)', background: 'var(--color-surface)',
                                        color: 'var(--color-text-main)', outline: 'none', cursor: 'pointer'
                                    }}
                                >
                                    <option value={1}>Priority 1 (High)</option>
                                    <option value={2}>Priority 2 (Medium)</option>
                                    <option value={3}>Priority 3 (Low)</option>
                                    <option value={4}>Priority 4 (None)</option>
                                </select>
                            </div>

                            {/* Repeat */}
                            <div>
                                <div style={{ display: 'flex', alignItems: 'center', gap: '8px', color: 'var(--color-text-secondary)', marginBottom: '8px', fontSize: '13px', fontWeight: 600 }}>
                                    <Repeat size={16} /> Repeat
                                </div>
                                <select
                                    value={selectedTodo.repeat_rule || ''}
                                    onChange={e => updateTodo(selectedTodo.id, { repeat_rule: (e.target.value || null) as RepeatRule | null })}
                                    style={{
                                        width: '100%', padding: '10px 12px', borderRadius: '8px',
                                        border: '1px solid var(--color-border)', background: 'var(--color-surface)',
                                        color: 'var(--color-text-main)', outline: 'none', cursor: 'pointer'
                                    }}
                                >
                                    {REPEAT_OPTIONS.map(o => <option key={o.value} value={o.value}>{o.label}</option>)}
                                </select>
                            </div>

                            {/* Reminder time */}
                            <div>
                                <div style={{ display: 'flex', alignItems: 'center', gap: '8px', color: 'var(--color-text-secondary)', marginBottom: '8px', fontSize: '13px', fontWeight: 600 }}>
                                    <Bell size={16} /> Remind at
                                </div>
                                <input
                                    type="time"
                                    value={selectedTodo.remind_at || ''}
                                    // Clearing the time also clears the "already reminded today" mark, so
                                    // re-setting a reminder the same day fires again rather than staying silent.
                                    onChange={e => updateTodo(selectedTodo.id, { remind_at: e.target.value || null, last_reminded_on: null })}
                                    style={{
                                        width: '100%', padding: '10px 12px', borderRadius: '8px',
                                        border: '1px solid var(--color-border)', background: 'var(--color-surface)',
                                        color: 'var(--color-text-main)', outline: 'none', cursor: 'pointer'
                                    }}
                                />
                            </div>
                        </div>
                    </div>
                    
                    {/* Drawer Footer */}
                    <div style={{ padding: '16px 20px', borderTop: '1px solid var(--color-border)', display: 'flex', justifyContent: 'flex-end' }}>
                        <button onClick={() => { flushTextUpdate(); setSelectedTodo(null); }} className="primary-button">Done</button>
                    </div>
                </div>
            )}
        </div>
    );
};

export default TodoPage;
