
import React from 'react';
import { Navigate } from 'react-router-dom';
import { useStore } from '../context/StoreContext';
import type { Permission } from '../types';

interface ProtectedRouteProps {
    children: React.ReactNode;
    requiredPermission?: Permission;
    requiredPermissions?: Permission[];
}

const ProtectedRoute: React.FC<ProtectedRouteProps> = ({ children, requiredPermission, requiredPermissions }) => {
    const { currentUser, hasPermission } = useStore();

    if (!currentUser) {
        return <Navigate to="/" replace />; // Or login, but App handles that
    }

    if (requiredPermissions) {
        // OR logic: if user has AT LEAST ONE of the required permissions
        const hasAccess = requiredPermissions.some(p => hasPermission(p));
        if (!hasAccess) {
            return <Navigate to="/" replace />;
        }
    } else if (requiredPermission && !hasPermission(requiredPermission)) {
        return <Navigate to="/" replace />;
    }

    return <>{children}</>;
};

export default ProtectedRoute;
