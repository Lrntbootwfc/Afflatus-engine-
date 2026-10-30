import { Router } from 'express';
import { resolveUserIdAsync } from '../services/firebaseAdmin';
import { listProjects, addProject, deleteProject, getUser } from '../services/dataStore';

export const projectListingsRoutes = Router();

function roleTokens(user: any): string[] {
  return [
    user?.primaryRole || '',
    ...((user?.secondaryRoles as string[]) || []),
    ...((user?.professions as string[]) || []),
  ]
    .map((r) => String(r || '').trim().toLowerCase())
    .filter(Boolean);
}

function rolesMatch(viewerRoles: string[], requiredRoles: string[]): boolean {
  const required = (requiredRoles || []).map((r) => String(r || '').trim().toLowerCase()).filter(Boolean);
  if (!required.length || !viewerRoles.length) return false;
  return viewerRoles.some((vr) => required.some((rr) => rr.includes(vr) || vr.includes(rr)));
}

// POST /api/project-listings — create a project listing (no image fields)
projectListingsRoutes.post('/project-listings', async (req, res) => {
  try {
    const ownerId = await resolveUserIdAsync(req);
    if (!ownerId) return res.status(401).json({ error: 'Authentication required' });

    const { title, description, requiredRoles, location } = req.body || {};
    if (!title || typeof title !== 'string' || !title.trim()) {
      return res.status(400).json({ error: 'title is required' });
    }
    const roles = Array.isArray(requiredRoles)
      ? requiredRoles.map((r) => String(r || '').trim()).filter(Boolean)
      : [];
    if (!roles.length) {
      return res.status(400).json({ error: 'At least one required role is needed' });
    }

    const owner = await getUser(ownerId);
    const listing = await addProject({
      ownerId,
      ownerName: owner?.name || owner?.username || 'Creator',
      ownerAvatar: owner?.avatarUrl || null,
      title: title.trim().slice(0, 150),
      description: typeof description === 'string' ? description.trim().slice(0, 2000) : '',
      requiredRoles: roles.slice(0, 10),
      location: typeof location === 'string' ? location.trim().slice(0, 120) : '',
      createdAt: new Date().toISOString(),
    });

    res.status(201).json({ success: true, listing });
  } catch (err: any) {
    console.error('[project-listings] create failed:', err?.message || err);
    res.status(500).json({ error: 'Could not create project listing' });
  }
});

// GET /api/project-listings — only listings that need the viewer's role (or that they own)
projectListingsRoutes.get('/project-listings', async (req, res) => {
  try {
    const viewerId = await resolveUserIdAsync(req);
    if (!viewerId) return res.status(401).json({ error: 'Authentication required' });

    const viewer = await getUser(viewerId);
    const viewerRoles = roleTokens(viewer);

    const all = ((await listProjects(300)) || []) as any[];
    const visible = all.filter((p) => p.ownerId === viewerId || rolesMatch(viewerRoles, p.requiredRoles || []));

    visible.sort((a, b) => String(b.createdAt || '').localeCompare(String(a.createdAt || '')));

    res.json({
      success: true,
      listings: visible,
      viewerHasRole: viewerRoles.length > 0,
    });
  } catch (err: any) {
    console.error('[project-listings] list failed:', err?.message || err);
    res.status(500).json({ error: 'Could not load project listings' });
  }
});

// DELETE /api/project-listings/:id — owner-only
projectListingsRoutes.delete('/project-listings/:id', async (req, res) => {
  try {
    const userId = await resolveUserIdAsync(req);
    if (!userId) return res.status(401).json({ error: 'Authentication required' });

    const all = ((await listProjects(300)) || []) as any[];
    const listing = all.find((p) => p.id === req.params.id);
    if (!listing) return res.status(404).json({ error: 'Listing not found' });
    if (listing.ownerId !== userId) return res.status(403).json({ error: 'Only the owner can delete this listing' });

    await deleteProject(req.params.id);
    res.json({ success: true });
  } catch (err: any) {
    console.error('[project-listings] delete failed:', err?.message || err);
    res.status(500).json({ error: 'Could not delete project listing' });
  }
});
