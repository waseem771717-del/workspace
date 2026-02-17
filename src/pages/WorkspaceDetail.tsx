import { useState, useEffect, useRef, useCallback } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { apiFetch } from '../lib/api';
import { useAuth } from '../contexts/AuthContext';

interface Document {
    id: string;
    filename: string;
    file_type: string;
    file_size: number;
    status: 'processing' | 'ready' | 'error';
    created_at: string;
}

interface WorkspaceDetail {
    id: string;
    name: string;
    description?: string;
    document_count: number;
    created_at: string;
    documents: Document[];
}

function formatFileSize(bytes: number): string {
    if (bytes < 1024) return bytes + ' B';
    if (bytes < 1024 * 1024) return (bytes / 1024).toFixed(1) + ' KB';
    return (bytes / (1024 * 1024)).toFixed(1) + ' MB';
}

export default function WorkspaceDetail() {
    const { id } = useParams<{ id: string }>();
    const navigate = useNavigate();
    const { user } = useAuth();
    const [workspace, setWorkspace] = useState<WorkspaceDetail | null>(null);
    const [loading, setLoading] = useState(true);
    const [uploading, setUploading] = useState(false);
    const [error, setError] = useState('');
    const [success, setSuccess] = useState('');
    const [dragOver, setDragOver] = useState(false);
    const fileInputRef = useRef<HTMLInputElement>(null);

    const fetchWorkspace = useCallback(async () => {
        if (!id) return;
        try {
            const data = await apiFetch<{ workspace: WorkspaceDetail }>(`/workspaces/${id}`);
            setWorkspace(data.workspace);
        } catch (err: any) {
            setError(err.message);
        } finally {
            setLoading(false);
        }
    }, [id]);

    useEffect(() => {
        fetchWorkspace();
    }, [fetchWorkspace]);

    // Poll for processing status
    useEffect(() => {
        if (!workspace) return;
        const hasProcessing = workspace.documents.some((d) => d.status === 'processing');
        if (!hasProcessing) return;

        const interval = setInterval(() => {
            fetchWorkspace();
        }, 5000);
        return () => clearInterval(interval);
    }, [workspace, fetchWorkspace]);

    const handleUpload = async (file: File) => {
        setError('');
        setSuccess('');

        const allowedTypes = [
            'application/pdf',
            'text/plain',
            'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
            'image/jpeg',
            'image/png',
            'image/webp',
            'text/csv',
            'text/markdown',
            'text/x-markdown'
        ];

        if (!allowedTypes.includes(file.type)) {
            setError('Only PDF, TXT, DOCX, Images, CSV, and MD files are allowed.');
            return;
        }

        if (file.size > 10 * 1024 * 1024) {
            setError('File size must be under 10MB.');
            return;
        }

        setUploading(true);
        try {
            const formData = new FormData();
            formData.append('file', file);
            formData.append('workspace_id', id!);

            const token = localStorage.getItem('token');
            const response = await fetch('/api/documents/upload', {
                method: 'POST',
                headers: {
                    ...(token ? { Authorization: `Bearer ${token}` } : {}),
                },
                body: formData,
            });

            if (!response.ok) {
                const errData = await response.json();
                throw new Error(errData.error || 'Upload failed');
            }

            setSuccess(`"${file.name}" uploaded successfully! Processing...`);
            fetchWorkspace();
        } catch (err: any) {
            setError(err.message || 'Upload failed');
        } finally {
            setUploading(false);
        }
    };

    const handleFileSelect = (e: React.ChangeEvent<HTMLInputElement>) => {
        const file = e.target.files?.[0];
        if (file) handleUpload(file);
        if (fileInputRef.current) fileInputRef.current.value = '';
    };

    const handleDrop = (e: React.DragEvent) => {
        e.preventDefault();
        setDragOver(false);
        const file = e.dataTransfer.files?.[0];
        if (file) handleUpload(file);
    };

    const handleDeleteDocument = async (docId: string, filename: string) => {
        if (!confirm(`Delete "${filename}"? This cannot be undone.`)) return;
        try {
            await apiFetch(`/documents/${docId}`, { method: 'DELETE' });
            setSuccess(`"${filename}" deleted.`);
            fetchWorkspace();
        } catch (err: any) {
            setError(err.message);
        }
    };

    const statusBadge = (status: string) => {
        const styles: Record<string, string> = {
            ready: 'bg-emerald-500/20 text-emerald-400 border-emerald-500/30',
            processing: 'bg-amber-500/20 text-amber-400 border-amber-500/30',
            error: 'bg-red-500/20 text-red-400 border-red-500/30',
        };
        const labels: Record<string, string> = {
            ready: '● Ready',
            processing: '◌ Processing',
            error: '✕ Error',
        };
        return (
            <span className={`text-xs px-2 py-0.5 rounded-full border ${styles[status] || ''}`}>
                {labels[status] || status}
            </span>
        );
    };

    if (loading) {
        return (
            <div className="p-6 lg:p-8">
                <div className="glass-card p-12 text-center">
                    <div className="w-10 h-10 border-4 border-primary-500 border-t-transparent rounded-full animate-spin mx-auto mb-4" />
                    <p className="text-dark-400 text-sm">Loading workspace...</p>
                </div>
            </div>
        );
    }

    if (!workspace) {
        return (
            <div className="p-6 lg:p-8">
                <div className="glass-card p-12 text-center">
                    <p className="text-dark-400 text-sm">Workspace not found</p>
                </div>
            </div>
        );
    }

    const readyDocCount = workspace.documents.filter(d => d.status === 'ready').length;

    return (
        <div className="p-6 lg:p-8 animate-fade-in">
            {/* Header */}
            <div className="flex flex-col sm:flex-row sm:items-start sm:justify-between gap-4 mb-8">
                <div>
                    <div className="flex items-center gap-3 mb-2">
                        <button
                            onClick={() => navigate('/workspaces')}
                            className="p-2 rounded-lg text-dark-400 hover:text-dark-200 hover:bg-dark-700 transition-all"
                        >
                            <svg xmlns="http://www.w3.org/2000/svg" className="w-5 h-5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                                <line x1="19" y1="12" x2="5" y2="12" />
                                <polyline points="12 19 5 12 12 5" />
                            </svg>
                        </button>
                        <h1 className="text-2xl font-bold gradient-text">{workspace.name}</h1>
                    </div>
                    {workspace.description && (
                        <p className="text-dark-400 text-sm ml-14">{workspace.description}</p>
                    )}
                    <p className="text-dark-500 text-sm ml-14 mt-1">
                        {workspace.document_count} {workspace.document_count === 1 ? 'document' : 'documents'}
                    </p>
                </div>
                {readyDocCount > 0 && (
                    <button
                        onClick={() => navigate(`/workspaces/${id}/chat`)}
                        className="px-5 py-2.5 rounded-xl bg-primary-600 text-white hover:bg-primary-700 transition-all font-medium flex items-center gap-2"
                    >
                        <svg xmlns="http://www.w3.org/2000/svg" className="w-5 h-5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                            <path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z" />
                        </svg>
                        Ask Questions
                    </button>
                )}
            </div>

            {/* Messages */}
            {error && (
                <div className="mb-6 p-4 rounded-xl bg-red-500/10 border border-red-500/30 text-red-400 text-sm flex justify-between items-center">
                    <span>{error}</span>
                    <button onClick={() => setError('')} className="text-red-400 hover:text-red-300 ml-4">✕</button>
                </div>
            )}
            {success && (
                <div className="mb-6 p-4 rounded-xl bg-emerald-500/10 border border-emerald-500/30 text-emerald-400 text-sm flex justify-between items-center">
                    <span>{success}</span>
                    <button onClick={() => setSuccess('')} className="text-emerald-400 hover:text-emerald-300 ml-4">✕</button>
                </div>
            )}

            {/* Upload Area */}
            <div
                onDragOver={(e) => { e.preventDefault(); setDragOver(true); }}
                onDragLeave={() => setDragOver(false)}
                onDrop={handleDrop}
                onClick={() => fileInputRef.current?.click()}
                className={`glass-card p-8 mb-8 text-center cursor-pointer transition-all duration-300 ${dragOver
                        ? 'border-primary-400 bg-primary-500/10 shadow-lg shadow-primary-500/10'
                        : 'hover:border-dark-500 hover:bg-dark-700/30'
                    } ${uploading ? 'opacity-60 pointer-events-none' : ''}`}
            >
                <input
                    ref={fileInputRef}
                    type="file"
                    accept=".pdf,.txt,.docx,.csv,.md,application/pdf,text/plain,application/vnd.openxmlformats-officedocument.wordprocessingml.document,text/csv,text/markdown,image/*"
                    onChange={handleFileSelect}
                    className="hidden"
                />
                <div className="flex flex-col items-center gap-3">
                    {uploading ? (
                        <>
                            <div className="w-10 h-10 border-4 border-primary-500 border-t-transparent rounded-full animate-spin" />
                            <p className="text-dark-300 text-sm">Uploading...</p>
                        </>
                    ) : (
                        <>
                            <div className="text-primary-400">
                                <svg xmlns="http://www.w3.org/2000/svg" className="w-8 h-8" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                                    <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" />
                                    <polyline points="17 8 12 3 7 8" />
                                    <line x1="12" y1="3" x2="12" y2="15" />
                                </svg>
                            </div>
                            <div>
                                <p className="text-dark-200 font-medium">
                                    Drop a file here or <span className="text-primary-400">browse</span>
                                </p>
                                <p className="text-dark-500 text-xs mt-1">PDF, DOCX, TXT, CSV, MD, Images • Max 10MB</p>
                            </div>
                        </>
                    )}
                </div>
            </div>

            {/* Documents List */}
            <div>
                <h2 className="text-lg font-semibold text-dark-200 mb-4">Documents</h2>
                {workspace.documents.length === 0 ? (
                    <div className="glass-card p-12 text-center">
                        <p className="text-dark-400 text-sm">No documents yet. Upload one to get started!</p>
                    </div>
                ) : (
                    <div className="space-y-3">
                        {workspace.documents.map((doc) => (
                            <div key={doc.id} className="glass-card p-4 flex items-center gap-4 hover:bg-dark-700/40 transition-all group">
                                {/* File icon */}
                                <div className={`w-10 h-10 rounded-xl flex items-center justify-center text-xs font-bold uppercase ${doc.file_type === 'pdf' ? 'bg-red-500/20 text-red-400' :
                                        doc.file_type === 'docx' ? 'bg-blue-600/20 text-blue-400' :
                                            ['jpg', 'jpeg', 'png', 'webp'].includes(doc.file_type) ? 'bg-purple-500/20 text-purple-400' :
                                                doc.file_type === 'csv' ? 'bg-green-500/20 text-green-400' :
                                                    doc.file_type === 'md' ? 'bg-yellow-500/20 text-yellow-400' :
                                                        'bg-gray-500/20 text-gray-400'
                                    }`}>
                                    {doc.file_type.length > 4 ? doc.file_type.slice(0, 3) : doc.file_type}
                                </div>

                                {/* Info */}
                                <div className="flex-1 min-w-0">
                                    <p className="text-dark-200 font-medium truncate text-sm">{doc.filename}</p>
                                    <div className="flex items-center gap-3 mt-1">
                                        <span className="text-dark-500 text-xs">{formatFileSize(doc.file_size)}</span>
                                        <span className="text-dark-600 text-xs">•</span>
                                        <span className="text-dark-500 text-xs">{new Date(doc.created_at).toLocaleDateString()}</span>
                                    </div>
                                </div>

                                {/* Status + Actions */}
                                <div className="flex items-center gap-3 shrink-0">
                                    {statusBadge(doc.status)}
                                    <button
                                        onClick={() => handleDeleteDocument(doc.id, doc.filename)}
                                        className="p-2 rounded-lg text-dark-500 hover:text-red-400 hover:bg-red-500/10 transition-colors opacity-0 group-hover:opacity-100"
                                    >
                                        <svg xmlns="http://www.w3.org/2000/svg" className="w-4 h-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                                            <polyline points="3 6 5 6 21 6" />
                                            <path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2" />
                                        </svg>
                                    </button>
                                </div>
                            </div>
                        ))}
                    </div>
                )}
            </div>
        </div>
    );
}
