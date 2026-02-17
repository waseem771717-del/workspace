import { useState, useEffect, useRef } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { apiFetch } from '../lib/api';

interface DocumentSource {
    type: 'document';
    document_id: string;
    document_name: string;
    chunk_index: number;
    excerpt: string;
    relevance_score: number;
}

interface WebSource {
    type: 'web';
    url: string;
    title: string;
    domain: string;
    excerpt: string;
    published_date?: string;
    relevance_score: number;
    domain_authority?: number;
    favicon_url?: string;
}

interface ChatMessage {
    role: 'user' | 'assistant';
    content: string;
    sources?: {
        documents: DocumentSource[];
        web: WebSource[];
    };
    metadata?: {
        used_web_search: boolean;
        web_sources_count: number;
        document_sources_count: number;
        cache_hit: boolean;
    };
    timestamp: Date;
}

interface WorkspaceInfo {
    id: string;
    name: string;
    document_count: number;
}

export default function WorkspaceChat() {
    const { id } = useParams<{ id: string }>();
    const navigate = useNavigate();
    const [workspace, setWorkspace] = useState<WorkspaceInfo | null>(null);
    const [messages, setMessages] = useState<ChatMessage[]>([]);
    const [question, setQuestion] = useState('');
    const [loading, setLoading] = useState(false);
    const [error, setError] = useState('');
    const [expandedSources, setExpandedSources] = useState<Set<number>>(new Set());
    const [includeWebSearch, setIncludeWebSearch] = useState(true);
    const [webSearchDepth, setWebSearchDepth] = useState<'basic' | 'deep'>('basic');
    const chatEndRef = useRef<HTMLDivElement>(null);

    useEffect(() => {
        const fetchWorkspace = async () => {
            if (!id) return;
            try {
                const data = await apiFetch<{ workspace: WorkspaceInfo }>(`/workspaces/${id}`);
                setWorkspace(data.workspace);
            } catch (err: any) {
                setError(err.message);
            }
        };
        fetchWorkspace();
    }, [id]);

    useEffect(() => {
        chatEndRef.current?.scrollIntoView({ behavior: 'smooth' });
    }, [messages]);

    const handleAsk = async (e: React.FormEvent) => {
        e.preventDefault();
        if (!question.trim() || loading) return;

        const userMessage: ChatMessage = {
            role: 'user',
            content: question.trim(),
            timestamp: new Date(),
        };

        setMessages((prev) => [...prev, userMessage]);
        setQuestion('');
        setLoading(true);
        setError('');

        try {
            const data = await apiFetch<{
                answer: string;
                sources: { documents: DocumentSource[]; web: WebSource[] };
                metadata: any;
            }>(
                `/workspaces/${id}/query`,
                {
                    method: 'POST',
                    body: JSON.stringify({
                        question: userMessage.content,
                        include_web_search: includeWebSearch,
                        web_search_depth: webSearchDepth
                    }),
                }
            );

            const assistantMessage: ChatMessage = {
                role: 'assistant',
                content: data.answer,
                sources: data.sources,
                metadata: data.metadata,
                timestamp: new Date(),
            };

            setMessages((prev) => [...prev, assistantMessage]);
        } catch (err: any) {
            setError(err.message);
        } finally {
            setLoading(false);
        }
    };

    const toggleSource = (messageIndex: number) => {
        const newExpanded = new Set(expandedSources);
        if (newExpanded.has(messageIndex)) {
            newExpanded.delete(messageIndex);
        } else {
            newExpanded.add(messageIndex);
        }
        setExpandedSources(newExpanded);
    };

    if (!workspace) {
        return (
            <div className="p-6 lg:p-8">
                <div className="glass-card p-12 text-center">
                    <div className="w-10 h-10 border-4 border-primary-500 border-t-transparent rounded-full animate-spin mx-auto mb-4" />
                    <p className="text-dark-400 text-sm">Loading...</p>
                </div>
            </div>
        );
    }

    return (
        <div className="flex flex-col h-screen">
            {/* Header */}
            <div className="p-4 md:p-6 border-b border-dark-700 bg-dark-800/50">
                <div className="flex items-center justify-between">
                    <div className="flex items-center gap-3">
                        <button
                            onClick={() => navigate(`/workspaces/${id}`)}
                            className="p-2 rounded-lg text-dark-400 hover:text-dark-200 hover:bg-dark-700 transition-all"
                        >
                            <svg xmlns="http://www.w3.org/2000/svg" className="w-5 h-5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                                <line x1="19" y1="12" x2="5" y2="12" />
                                <polyline points="12 19 5 12 12 5" />
                            </svg>
                        </button>
                        <div>
                            <h1 className="text-xl font-bold gradient-text">{workspace.name}</h1>
                            <p className="text-dark-500 text-xs mt-0.5">
                                Hybrid Q&A • {workspace.document_count} {workspace.document_count === 1 ? 'document' : 'documents'}
                            </p>
                        </div>
                    </div>

                    {/* Web Search Toggle */}
                    <div className="flex items-center gap-3">
                        <label className="flex items-center gap-2 cursor-pointer text-sm">
                            <input
                                type="checkbox"
                                checked={includeWebSearch}
                                onChange={(e) => setIncludeWebSearch(e.target.checked)}
                                className="w-4 h-4 rounded bg-dark-700 border-dark-600 text-primary-600 focus:ring-primary-500"
                            />
                            <span className="text-dark-300 hidden sm:inline">Web Search</span>
                            <span className="text-dark-300 sm:hidden">🌐</span>
                        </label>

                        {includeWebSearch && (
                            <select
                                value={webSearchDepth}
                                onChange={(e) => setWebSearchDepth(e.target.value as 'basic' | 'deep')}
                                className="px-2 py-1 text-xs rounded-lg bg-dark-700 border border-dark-600 text-dark-200 focus:border-primary-500 focus:outline-none"
                            >
                                <option value="basic">Basic</option>
                                <option value="deep">Deep</option>
                            </select>
                        )}
                    </div>
                </div>
            </div>

            {/* Chat Messages */}
            <div className="flex-1 overflow-y-auto p-4 md:p-6 space-y-6">
                {messages.length === 0 ? (
                    <div className="text-center mt-12">
                        <div className="w-16 h-16 rounded-2xl bg-primary-600/20 text-primary-400 flex items-center justify-center mx-auto mb-4">
                            <svg xmlns="http://www.w3.org/2000/svg" className="w-8 h-8" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                                <path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z" />
                            </svg>
                        </div>
                        <h2 className="text-lg font-semibold text-dark-200 mb-2">Hybrid Knowledge Search</h2>
                        <p className="text-dark-400 text-sm max-w-md mx-auto">
                            Ask questions and get answers from your documents {includeWebSearch && '+ real-time web search'} with source citations.
                        </p>
                    </div>
                ) : (
                    messages.map((msg, i) => (
                        <div key={i} className={`flex ${msg.role === 'user' ? 'justify-end' : 'justify-start'}`}>
                            <div className={`max-w-2xl ${msg.role === 'user' ? 'ml-12' : 'mr-12'} w-full`}>
                                {msg.role === 'user' ? (
                                    <div className="bg-primary-600 text-white p-4 rounded-2xl rounded-tr-sm">
                                        <p className="text-sm">{msg.content}</p>
                                    </div>
                                ) : (
                                    <div className="space-y-3">
                                        <div className="glass-card p-4 rounded-2xl rounded-tl-sm">
                                            <p className="text-dark-200 text-sm leading-relaxed whitespace-pre-wrap">{msg.content}</p>

                                            {/* Metadata Badge */}
                                            {msg.metadata && (
                                                <div className="flex items-center gap-2 mt-3 pt-3 border-t border-dark-700">
                                                    <div className="flex items-center gap-2 text-xs text-dark-500">
                                                        {msg.metadata.document_sources_count > 0 && (
                                                            <span className="px-2 py-0.5 rounded-full bg-primary-500/20 text-primary-400">
                                                                📄 {msg.metadata.document_sources_count}
                                                            </span>
                                                        )}
                                                        {msg.metadata.web_sources_count > 0 && (
                                                            <span className="px-2 py-0.5 rounded-full bg-emerald-500/20 text-emerald-400">
                                                                🌐 {msg.metadata.web_sources_count}
                                                            </span>
                                                        )}
                                                        {msg.metadata.cache_hit && (
                                                            <span className="px-2 py-0.5 rounded-full bg-blue-500/20 text-blue-400">
                                                                ⚡ Cached
                                                            </span>
                                                        )}
                                                    </div>
                                                </div>
                                            )}
                                        </div>

                                        {/* Sources Section */}
                                        {msg.sources && (msg.sources.documents?.length > 0 || msg.sources.web?.length > 0) && (
                                            <div className="ml-4">
                                                <button
                                                    onClick={() => toggleSource(i)}
                                                    className="text-dark-400 hover:text-dark-200 text-xs flex items-center gap-2 mb-2 transition-colors"
                                                >
                                                    <svg xmlns="http://www.w3.org/2000/svg" className={`w-4 h-4 transition-transform ${expandedSources.has(i) ? 'rotate-90' : ''}`} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                                                        <polyline points="9 18 15 12 9 6" />
                                                    </svg>
                                                    📚 Sources ({(msg.sources.documents?.length || 0) + (msg.sources.web?.length || 0)})
                                                </button>

                                                {expandedSources.has(i) && (
                                                    <div className="space-y-3">
                                                        {/* Document Sources */}
                                                        {msg.sources.documents && msg.sources.documents.length > 0 && (
                                                            <div>
                                                                <h4 className="text-xs font-semibold text-primary-400 mb-2 flex items-center gap-2">
                                                                    📄 Documents ({msg.sources.documents.length})
                                                                </h4>
                                                                <div className="space-y-2">
                                                                    {msg.sources.documents.map((doc, j) => (
                                                                        <div key={j} className="glass-card p-3 text-xs">
                                                                            <div className="flex items-start justify-between mb-2">
                                                                                <p className="font-medium text-primary-400">{doc.document_name}</p>
                                                                                <span className="text-dark-500 ml-2 shrink-0">
                                                                                    {Math.round(doc.relevance_score * 100)}%
                                                                                </span>
                                                                            </div>
                                                                            <p className="text-dark-400 leading-relaxed">{doc.excerpt}</p>
                                                                        </div>
                                                                    ))}
                                                                </div>
                                                            </div>
                                                        )}

                                                        {/* Web Sources */}
                                                        {msg.sources.web && msg.sources.web.length > 0 && (
                                                            <div>
                                                                <h4 className="text-xs font-semibold text-emerald-400 mb-2 flex items-center gap-2">
                                                                    🌐 Web ({msg.sources.web.length})
                                                                </h4>
                                                                <div className="space-y-2">
                                                                    {msg.sources.web.map((web, j) => (
                                                                        <div key={j} className="glass-card p-3 text-xs border-l-2 border-emerald-500/30">
                                                                            <div className="flex items-start justify-between mb-1">
                                                                                <a
                                                                                    href={web.url}
                                                                                    target="_blank"
                                                                                    rel="noopener noreferrer"
                                                                                    className="font-medium text-emerald-400 hover:text-emerald-300 flex items-center gap-1 flex-1"
                                                                                >
                                                                                    {web.favicon_url && (
                                                                                        <img src={web.favicon_url} alt="" className="w-4 h-4" />
                                                                                    )}
                                                                                    <span className="truncate">{web.title}</span>
                                                                                    <svg xmlns="http://www.w3.org/2000/svg" className="w-3 h-3 shrink-0" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                                                                                        <path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6" />
                                                                                        <polyline points="15 3 21 3 21 9" />
                                                                                        <line x1="10" y1="14" x2="21" y2="3" />
                                                                                    </svg>
                                                                                </a>
                                                                                <span className="text-dark-500 ml-2 shrink-0">
                                                                                    {Math.round(web.relevance_score * 100)}%
                                                                                </span>
                                                                            </div>
                                                                            <p className="text-dark-500 text-xs mb-1 flex items-center gap-2">
                                                                                <span>{web.domain}</span>
                                                                                {web.published_date && (
                                                                                    <>
                                                                                        <span>•</span>
                                                                                        <span>{new Date(web.published_date).toLocaleDateString()}</span>
                                                                                    </>
                                                                                )}
                                                                            </p>
                                                                            <p className="text-dark-400 leading-relaxed">{web.excerpt}</p>
                                                                        </div>
                                                                    ))}
                                                                </div>
                                                            </div>
                                                        )}
                                                    </div>
                                                )}
                                            </div>
                                        )}
                                    </div>
                                )}
                                <p className="text-dark-600 text-xs mt-1 px-1">
                                    {msg.timestamp.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                                </p>
                            </div>
                        </div>
                    ))
                )}

                {loading && (
                    <div className="flex justify-start">
                        <div className="glass-card p-4 rounded-2xl rounded-tl-sm mr-12">
                            <div className="flex gap-2">
                                <div className="w-2 h-2 bg-primary-400 rounded-full animate-bounce" style={{ animationDelay: '0ms' }} />
                                <div className="w-2 h-2 bg-primary-400 rounded-full animate-bounce" style={{ animationDelay: '150ms' }} />
                                <div className="w-2 h-2 bg-primary-400 rounded-full animate-bounce" style={{ animationDelay: '300ms' }} />
                            </div>
                            {includeWebSearch && (
                                <p className="text-dark-500 text-xs mt-2">Searching documents + web...</p>
                            )}
                        </div>
                    </div>
                )}

                <div ref={chatEndRef} />
            </div>

            {/* Input Area */}
            <div className="p-4 md:p-6 border-t border-dark-700 bg-dark-800/50">
                {error && (
                    <div className="mb-4 p-3 rounded-xl bg-red-500/10 border border-red-500/30 text-red-400 text-sm flex justify-between items-center">
                        <span>{error}</span>
                        <button onClick={() => setError('')} className="text-red-400 hover:text-red-300 ml-4">✕</button>
                    </div>
                )}

                <form onSubmit={handleAsk} className="flex gap-3">
                    <input
                        type="text"
                        value={question}
                        onChange={(e) => setQuestion(e.target.value)}
                        placeholder={includeWebSearch ? "Ask anything (docs + web)..." : "Ask about your documents..."}
                        maxLength={500}
                        className="flex-1 p-3 md:p-4 rounded-xl bg-dark-700 border border-dark-600 text-dark-100 placeholder-dark-500 focus:border-primary-500 focus:outline-none"
                        disabled={loading}
                    />
                    <button
                        type="submit"
                        disabled={loading || !question.trim()}
                        className="px-5 md:px-6 py-3 md:py-4 rounded-xl bg-primary-600 text-white hover:bg-primary-700 transition-all disabled:opacity-50 disabled:cursor-not-allowed flex items-center gap-2"
                    >
                        <svg xmlns="http://www.w3.org/2000/svg" className="w-5 h-5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                            <line x1="22" y1="2" x2="11" y2="13" />
                            <polygon points="22 2 15 22 11 13 2 9 22 2" />
                        </svg>
                        <span className="hidden md:inline">Send</span>
                    </button>
                </form>
                <p className="text-dark-600 text-xs mt-2 text-center">
                    {includeWebSearch
                        ? '🔍 Hybrid search: workspace documents + real-time web results'
                        : '📚 Searching only workspace documents'
                    }
                </p>
            </div>
        </div>
    );
}
