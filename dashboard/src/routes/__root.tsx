import { createRootRoute, Outlet } from '@tanstack/react-router';
import { DashboardLayout } from '@/components/layout/DashboardLayout';

export const Route = createRootRoute({
  component: () => (
    <DashboardLayout>
      <Outlet />
    </DashboardLayout>
  ),
});
