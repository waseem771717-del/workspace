import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom';
import { AuthProvider } from './contexts/AuthContext';
import ProtectedRoute from './components/ProtectedRoute';
import Layout from './components/Layout';
import Login from './pages/Login';
import Signup from './pages/Signup';
import AwaitingApproval from './pages/AwaitingApproval';
import Dashboard from './pages/Dashboard';
import UserManagement from './pages/UserManagement';
import Profile from './pages/Profile';
import Summarizer from './pages/Summarizer';
import SummaryHistory from './pages/SummaryHistory';
import SummaryDetail from './pages/SummaryDetail';
import Documents from './pages/Documents';
import DocumentChat from './pages/DocumentChat';
import Workspaces from './pages/Workspaces';
import WorkspaceDetail from './pages/WorkspaceDetail';
import WorkspaceChat from './pages/WorkspaceChat';

export default function App() {
    return (
        <AuthProvider>
            <BrowserRouter>
                <Routes>
                    {/* Public routes */}
                    <Route path="/login" element={<Login />} />
                    <Route path="/signup" element={<Signup />} />
                    <Route path="/awaiting-approval" element={<AwaitingApproval />} />

                    {/* Protected routes */}
                    <Route
                        element={
                            <ProtectedRoute>
                                <Layout />
                            </ProtectedRoute>
                        }
                    >
                        <Route path="/dashboard" element={<Dashboard />} />
                        <Route path="/profile" element={<Profile />} />
                        <Route path="/summarizer" element={<Summarizer />} />
                        <Route path="/summaries" element={<SummaryHistory />} />
                        <Route path="/summaries/:id" element={<SummaryDetail />} />
                        <Route path="/workspaces" element={<Workspaces />} />
                        <Route path="/workspaces/:id" element={<WorkspaceDetail />} />
                        <Route path="/workspaces/:id/chat" element={<WorkspaceChat />} />
                        <Route path="/documents" element={<Documents />} />
                        <Route path="/documents/:id" element={<DocumentChat />} />
                        <Route
                            path="/users"
                            element={
                                <ProtectedRoute requiredRole="admin">
                                    <UserManagement />
                                </ProtectedRoute>
                            }
                        />
                        <Route
                            path="/all-summaries"
                            element={
                                <ProtectedRoute requiredRole="admin">
                                    <SummaryHistory showAll />
                                </ProtectedRoute>
                            }
                        />
                    </Route>

                    {/* Default redirect */}
                    <Route path="*" element={<Navigate to="/dashboard" replace />} />
                </Routes>
            </BrowserRouter>
        </AuthProvider>
    );
}
