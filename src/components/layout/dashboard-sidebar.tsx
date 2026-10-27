import { Logo } from '@/components/shared/logo';
import { SidebarMain } from '@/components/layout/sidebar-main';
import { SidebarUser } from '@/components/layout/sidebar-user';
import {
  Sidebar,
  SidebarContent,
  SidebarFooter,
  SidebarHeader,
  SidebarMenu,
  SidebarMenuButton,
  SidebarMenuItem,
  useSidebar,
} from '@/components/ui/sidebar';
import { websiteConfig } from '@/config/website';
import { Link } from '@tanstack/react-router';
import { Routes } from '@/lib/routes';
import type { SessionUser } from '@/auth/types';
import type * as React from 'react';

type DashboardSidebarProps = React.ComponentProps<typeof Sidebar> & {
  user: SessionUser;
};

/**
 * Dashboard sidebar
 */
export function DashboardSidebar({ user, ...props }: DashboardSidebarProps) {
  const { isMobile, setOpenMobile } = useSidebar();

  const closeMobileSidebar = () => {
    if (isMobile) setOpenMobile(false);
  };

  return (
    <Sidebar collapsible="icon" {...props}>
      <SidebarHeader>
        <SidebarMenu>
          <SidebarMenuItem>
            <SidebarMenuButton
              render={
                <Link to={Routes.Root} onClick={closeMobileSidebar}>
                  <Logo className="size-5" />
                  <span className="truncate font-semibold text-base">
                    {websiteConfig.metadata?.name}
                  </span>
                </Link>
              }
              className="data-[slot=sidebar-menu-button]:!p-1.5"
            />
          </SidebarMenuItem>
        </SidebarMenu>
      </SidebarHeader>

      <SidebarContent>
        <SidebarMain user={user} />
      </SidebarContent>

      <SidebarFooter className="flex flex-col gap-4">
        <SidebarUser user={user} />
      </SidebarFooter>
    </Sidebar>
  );
}
