import { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { apiFetch } from '../lib/api';
import { useAuth } from '../contexts/AuthContext';

interface Workspace {
    id: string;
    name: string;
    description?: string;
    document_count: number;
    last_activity: string;
    created_at: string;
    user_name?: string;
    user_email?: string;
}

function FolderIcon() {
    return (
        <svg xmlns="http://www.w3.org/2000/svg" className="w-6 h-6" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
            <path d="M22 19a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5l2 3h9a2 2 0 0 1 2 2z" />
        </svg>
    );
}

export default function Workspaces() {
    const { user } = useAuth();
    const navigate = useNavigate();
    const [workspaces, setWorkspaces] = useState<Workspace[]>([]);
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState('');
    const [showAll, setShowAll] = useState(false);
    const [showCreateModal, setShowCreateModal] = useState(false);
    const [newWorkspace, setNewWorkspace] = useState({ name: '', description: '' });
    const [creating, setCreating] = useState(false);

    const isAdmin = user?.role === 'admin';

    const fetchWorkspaces = async () => {
        try {
            const url = showAll && isAdmin ? '/workspaces?all=true' : '/workspaces';
            const data = await apiFetch<{ workspaces: Workspace[] }>(url);
            setWorkspaces(data.workspaces);
        } catch (err: any) {
            setError(err.message);
        } finally {
            setLoading(false);
        }
    };

    useEffect(() => {
        fetchWorkspaces();
    }, [showAll]);

    const handleCreateWorkspace = async (e: React.FormEvent) => {
        e.preventDefault();
        if (!newWorkspace.name.trim()) {
            setError('Workspace name is required');
            return;
        }

        setCreating(true);
        setError('');
        try {
            await apiFetch('/workspaces', {
                method: 'POST',
                body: JSON.stringify(newWorkspace),
            });
            setShowCreateModal(false);
            setNewWorkspace({ name: '', description: '' });
            fetchWorkspaces();
        } catch (err: any) {
            setError(err.message);
        } finally {
            setCreating(false);
        }
    };

    const handleDeleteWorkspace = async (id: string, name: string) => {
        if (!confirm(`Delete workspace "${name}"? This will delete all documents in this workspace.`)) return;

        try {
            await apiFetch(`/workspaces/${id}`, { method: 'DELETE' });
            fetchWorkspaces();
        } catch (err: any) {
            setError(err.message);
        }
    };

    const formatDate = (dateStr: string) => {
        const date = new Date(dateStr);
        const now = new Date();
        const diffMs = now.getTime() - date.getTime();
        const diffMins = Math.floor(diffMs / 60000);
        const diffHours = Math.floor(diffMs / 3600000);
        const diffDays = Math.floor(diffMs / 86400000);

        if (diffMins < 60) return `${diffMins}m ago`;
        if (diffHours < 24) return `${diffHours}h ago`;
        if (diffDays < 7) return `${diffDays}d ago`;
        return date.toLocaleDateString();
    };

    return (
        <div className="p-6 lg:p-8 animate-fade-in">
            {/* Header */}
            <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4 mb-8">
                <div>
                    <h1 className="text-2xl font-bold gradient-text">Workspaces</h1>
                    <p className="text-dark-400 text-sm mt-1">
                        Organize documents into workspaces for multi-document Q&A
                    </p>
                </div>
                <div className="flex gap-3">
                    {isAdmin && (
                        <button
                            onClick={() => setShowAll(!showAll)}
                            className={`text-sm px-4 py-2 rounded-xl border transition-all ${showAll
                                    ? 'bg-primary-600/20 text-primary-400 border-primary-500/30'
                                    : 'text-dark-400 border-dark-700 hover:text-dark-200'
                                }`}
                        >
                            {showAll ? 'All Workspaces' : 'My Workspaces'}
                        </button>
                    )}
                    <button
                        onClick={() => setShowCreateModal(true)}
                        className="px-4 py-2 rounded-xl bg-primary-600 text-white hover:bg-primary-700 transition-all text-sm font-medium"
                    >
                        + New Workspace
                    </button>
                </div>
            </div>

            {/* Error Message */}
            {error && (
                <div className="mb-6 p-4 rounded-xl bg-red-500/10 border border-red-500/30 text-red-400 text-sm flex justify-between items-center">
                    <span>{error}</span>
                    <button onClick={() => setError('')} className="text-red-400 hover:text-red-300 ml-4">
                        ✕
                    </button>
                </div>
            )}

            {/* Workspaces Grid */}
            {loading ? (
                <div className="glass-card p-12 text-center">
                    <div className="w-10 h-10 border-4 border-primary-500 border-t-transparent rounded-full animate-spin mx-auto mb-4" />
                    <p className="text-dark-400 text-sm">Loading workspaces...</p>
                </div>
            ) : workspaces.length === 0 ? (
                <div className="glass-card p-12 text-center">
                    <div className="text-dark-600 mb-3 flex justify-center">
                        <FolderIcon />
                    </div>
                    <p className="text-dark-400 text-sm">No workspaces yet. Create one to get started!</p>
                </div>
            ) : (
                <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
                    {workspaces.map((workspace) => (
                        <div
                            key={workspace.id}
                            className="glass-card p-5 hover:bg-dark-700/40 transition-all cursor-pointer group"
                            onClick={() => navigate(`/workspaces/${workspace.id}`)}
                        >
                            <div className="flex items-start justify-between mb-3">
                                <div className="flex items-center gap-3">
                                    <div className="w-10 h-10 rounded-xl bg-primary-600/20 text-primary-400 flex items-center justify-center">
                                        <FolderIcon />
                                    </div>
                                    <div>
                                        <h3 className="text-dark-200 font-semibold">{workspace.name}</h3>
                                        {workspace.user_name && (
                                            <p className="text-dark-500 text-xs">{workspace.user_name}</p>
                                        )}
                                    </div>
                                </div>
                                <button
                                    onClick={(e) => {
                                        e.stopPropagation();
                                        handleDeleteWorkspace(workspace.id, workspace.name);
                                    }}
                                    className="p-2 rounded-lg text-dark-500 hover:text-red-400 hover:bg-red-500/10 transition-colors opacity-0 group-hover:opacity-100"
                                >
                                    <svg
                                        xmlns="http://www.w3.org/2000/svg"
                                        className="w-4 h-4"
                                        viewBox="0 0 24 24"
                                        fill="none"
                                        stroke="currentColor"
                                        strokeWidth="2"
                                    >
                                        <polyline points="3 6 5 6 21 6" />
                                        <path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2" />
                                    </svg>
                                </button>
                            </div>
                            {workspace.description && (
                                <p className="text-dark-400 text-sm mb-3 line-clamp-2">{workspace.description}</p>
                            )}
                            <div className="flex items-center justify-between text-xs text-dark-500">
                                <span>{workspace.document_count} {workspace.document_count === 1 ? 'document' : 'documents'}</span>
                                <span>{formatDate(workspace.last_activity)}</span>
                            </div>
                        </div>
                    ))}
                </div>
            )}

            {/* Create Workspace Modal */}
            {showCreateModal && (
                <div className="fixed inset-0 bg-black/60 flex items-center justify-center z-50 p-4">
                    <div className="glass-card max-w-md w-full p-6 animate-scale-in">
                        <h2 className="text-xl font-bold gradient-text mb-4">Create New Workspace</h2>
                        <form onSubmit={handleCreateWorkspace}>
                            <div className="mb-4">
                                <label className="block text-dark-300 text-sm mb-2">Workspace Name</label>
                                <input
                                    type="text"
                                    value={newWorkspace.name}
                                    onChange={(e) => setNewWorkspace({ ...newWorkspace, name: e.target.value })}
                                    className="w-full p-3 rounded-xl bg-dark-700 border border-dark-600 text-dark-100 focus:border-primary-500 focus:outline-none"
                                    placeholder="e.g., Q2 Financial Reports"
                                    maxLength={255}
                                    autoFocus
                                />
                            </div>
                            <div className="mb-6">
                                <label className="block text-dark-300 text-sm mb-2">Description (Optional)</label>
                                <textarea
                                    value={newWorkspace.description}
                                    onChange={(e) => setNewWorkspace({ ...newWorkspace, description: e.target.value })}
                                    className="w-full p-3 rounded-xl bg-dark-700 border border-dark-600 text-dark-100 focus:border-primary-500 focus:outline-none resize-none"
                                    placeholder="Brief description of this workspace..."
                                    rows={3}
                                />
                            </div>
                            <div className="flex gap-3">
                                <button
                                    type="button"
                                    onClick={() => {
                                        setShowCreateModal(false);
                                        setNewWorkspace({ name: '', description: '' });
                                        setError('');
                                    }}
                                    className="flex-1 px-4 py-2 rounded-xl border border-dark-600 text-dark-300 hover:bg-dark-700 transition-all"
                                >
                                    Cancel
                                </button>
                                <button
                                    type="submit"
                                    disabled={creating}
                                    className="flex-1 px-4 py-2 rounded-xl bg-primary-600 text-white hover:bg-primary-700 transition-all disabled:opacity-50 disabled:cursor-not-allowed"
                                >
                                    {creating ? 'Creating...' : 'Create'}
                                </button>
                            </div>
                        </form>
                    </div>
                </div>
            )}
        </div>
    );
}
