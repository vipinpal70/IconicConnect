'use client'

import React, { useState } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { 
  Bell, Check, Trash2, Filter, 
  Info, AlertTriangle, CheckCircle2, MessageSquare, 
  MoreHorizontal, Eye
} from 'lucide-react'
import { formatDistanceToNow } from 'date-fns'
import { 
  DropdownMenu, DropdownMenuContent, DropdownMenuItem, 
  DropdownMenuTrigger 
} from '@/src/components/ui/dropdown-menu'
import { Button } from '@/src/components/ui/button'
import { Badge } from '@/src/components/ui/badge'
import { toast } from 'sonner'
import { AdminLayout } from '@/src/components/AdminLayout'

type NotificationType = 'all' | 'approval' | 'case' | 'support' | 'system';
type FilterStatus = 'all' | 'unread' | 'read';

export default function NotificationsPage() {
  const queryClient = useQueryClient()
  const [type, setType] = useState<NotificationType>('all')
  const [filter, setFilter] = useState<FilterStatus>('all')

  const { data: notifications = [], isLoading } = useQuery({
    queryKey: ['notifications', type, filter],
    queryFn: async () => {
      const params = new URLSearchParams()
      if (type !== 'all') params.append('type', type)
      if (filter !== 'all') params.append('filter', filter)
      
      const res = await fetch(`/api/notifications?${params.toString()}`)
      if (!res.ok) throw new Error('Failed to fetch notifications')
      return res.json()
    }
  })

  const markReadMutation = useMutation({
    mutationFn: async ({ id, action }: { id?: string, action: string }) => {
      const res = await fetch('/api/notifications', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ id, action })
      })
      if (!res.ok) throw new Error('Failed to update notification')
      return res.json()
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['notifications'] })
    }
  })

  const handleAction = (id: string, action: 'read' | 'dismiss') => {
    markReadMutation.mutate({ id, action })
  }

  const handleMarkAllRead = () => {
    markReadMutation.mutate({ action: 'read_all' })
    toast.success('All notifications marked as read')
  }

  const getIcon = (type: string) => {
    switch (type) {
      case 'approval': return <CheckCircle2 className="w-5 h-5 text-green-500" />
      case 'case': return <MessageSquare className="w-5 h-5 text-blue-500" />
      case 'support': return <AlertTriangle className="w-5 h-5 text-orange-500" />
      default: return <Info className="w-5 h-5 text-gray-500" />
    }
  }

  const unreadCount = notifications.filter((n: any) => !n.isRead).length

  return (
    <AdminLayout>
      <div className="p-8 max-w-4xl mx-auto">
        <div className="flex flex-col md:flex-row md:items-center justify-between mb-8 gap-4">
          <div>
            <h1 className="text-2xl font-bold text-gray-900 flex items-center gap-3">
              Notifications
              {unreadCount > 0 && (
                <Badge variant="destructive" className="rounded-full px-2">
                  {unreadCount} new
                </Badge>
              )}
            </h1>
            <p className="text-gray-500 mt-1">Manage your alerts and system updates</p>
          </div>
          <div className="flex items-center gap-3">
            <Button 
              variant="outline" 
              size="sm" 
              onClick={handleMarkAllRead}
              disabled={unreadCount === 0}
            >
              <Check className="w-4 h-4 mr-2" /> Mark all as read
            </Button>
          </div>
        </div>

        {/* Filters */}
        <div className="flex items-center gap-2 mb-6 overflow-x-auto pb-2 scrollbar-hide">
          <Filter className="w-4 h-4 text-gray-400 mr-2 flex-shrink-0" />
          {[
            { label: 'All', value: 'all' },
            { label: 'Unread', value: 'unread' },
            { label: 'Read', value: 'read' }
          ].map((f) => (
            <button
              key={f.value}
              onClick={() => setFilter(f.value as FilterStatus)}
              className={`px-4 py-1.5 rounded-full text-sm font-medium transition whitespace-nowrap ${
                filter === f.value 
                  ? 'bg-gray-900 text-white shadow-sm' 
                  : 'bg-white text-gray-600 border border-gray-200 hover:border-gray-300'
              }`}
            >
              {f.label}
            </button>
          ))}
          <div className="w-px h-6 bg-gray-200 mx-2 flex-shrink-0" />
          {[
            { label: 'All Types', value: 'all' },
            { label: 'Approvals', value: 'approval' },
            { label: 'Cases', value: 'case' },
            { label: 'Support', value: 'support' }
          ].map((t) => (
            <button
              key={t.value}
              onClick={() => setType(t.value as NotificationType)}
              className={`px-4 py-1.5 rounded-full text-sm font-medium transition whitespace-nowrap ${
                type === t.value 
                  ? 'bg-[#00786f] text-white shadow-sm' 
                  : 'bg-white text-gray-600 border border-gray-200 hover:border-gray-300'
              }`}
            >
              {t.label}
            </button>
          ))}
        </div>

        {/* Notification List */}
        <div className="space-y-3">
          {isLoading ? (
            <div className="text-center py-12 text-gray-500">Loading notifications...</div>
          ) : notifications.length === 0 ? (
            <div className="bg-white rounded-2xl border border-dashed border-gray-300 p-12 text-center">
              <Bell className="w-12 h-12 text-gray-300 mx-auto mb-4" />
              <h3 className="text-lg font-medium text-gray-900">No notifications found</h3>
              <p className="text-gray-500 mt-1">You're all caught up!</p>
            </div>
          ) : (
            notifications.map((notification: any) => (
              <div 
                key={notification.id}
                className={`group relative bg-white rounded-2xl border transition-all duration-200 ${
                  notification.isRead 
                    ? 'border-gray-100 opacity-75' 
                    : 'border-gray-200 shadow-sm hover:shadow-md'
                }`}
              >
                <div className="p-4 flex items-start gap-4">
                  <div className={`p-2 rounded-xl flex-shrink-0 ${
                    notification.isRead ? 'bg-gray-50' : 'bg-gray-100'
                  }`}>
                    {getIcon(notification.type)}
                  </div>
                  
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center justify-between gap-2 mb-0.5">
                      <h4 className={`text-sm font-semibold truncate ${
                        notification.isRead ? 'text-gray-600' : 'text-gray-900'
                      }`}>
                        {notification.title}
                      </h4>
                      <span className="text-[11px] text-gray-400 whitespace-nowrap">
                        {formatDistanceToNow(new Date(notification.createdAt), { addSuffix: true })}
                      </span>
                    </div>
                    <p className={`text-sm leading-relaxed ${
                      notification.isRead ? 'text-gray-500' : 'text-gray-700'
                    }`}>
                      {notification.message}
                    </p>
                  </div>

                  <div className="flex-shrink-0 opacity-0 group-hover:opacity-100 transition-opacity">
                    <DropdownMenu>
                      <DropdownMenuTrigger asChild>
                        <Button variant="ghost" size="icon" className="h-8 w-8">
                          <MoreHorizontal className="w-4 h-4" />
                        </Button>
                      </DropdownMenuTrigger>
                      <DropdownMenuContent align="end" className="w-40">
                        {!notification.isRead && (
                          <DropdownMenuItem onClick={() => handleAction(notification.id, 'read')}>
                            <Check className="w-4 h-4 mr-2" /> Mark as read
                          </DropdownMenuItem>
                        )}
                        <DropdownMenuItem 
                          onClick={() => handleAction(notification.id, 'dismiss')}
                          className="text-red-600 focus:text-red-600"
                        >
                          <Trash2 className="w-4 h-4 mr-2" /> Dismiss
                        </DropdownMenuItem>
                      </DropdownMenuContent>
                    </DropdownMenu>
                  </div>
                </div>
                
                {!notification.isRead && (
                  <div className="absolute left-0 top-1/2 -translate-y-1/2 w-1 h-8 bg-[#00786f] rounded-r-full" />
                )}
              </div>
            ))
          )}
        </div>
      </div>
    </AdminLayout>
  )
}
