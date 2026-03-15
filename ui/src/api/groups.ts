import { api } from './client';

export interface GroupItem {
  id: number;
  group_id: number;
  channel_id: number;
  model_name: string;
  priority: number;
  weight: number;
}

export interface Group {
  id: number;
  name: string;
  mode: number;
  match_regex: string;
  first_token_timeout: number;
  items: GroupItem[];
}

export function listGroups(): Promise<Group[]> {
  return api<Group[]>('/api/v1/groups');
}

export function getGroup(id: number): Promise<Group> {
  return api<Group>(`/api/v1/groups/${id}`);
}

export function createGroup(data: Partial<Group>): Promise<Group> {
  return api<Group>('/api/v1/groups', {
    method: 'POST',
    body: JSON.stringify(data),
  });
}

export function updateGroup(id: number, data: Partial<Group>): Promise<Group> {
  return api<Group>(`/api/v1/groups/${id}`, {
    method: 'PUT',
    body: JSON.stringify(data),
  });
}

export function deleteGroup(id: number): Promise<void> {
  return api<void>(`/api/v1/groups/${id}`, { method: 'DELETE' });
}

export function addGroupItem(groupId: number, item: Omit<GroupItem, 'id' | 'group_id'>): Promise<GroupItem> {
  return api<GroupItem>(`/api/v1/groups/${groupId}/items`, {
    method: 'POST',
    body: JSON.stringify(item),
  });
}
