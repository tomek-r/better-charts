import { SideDrawer } from '../side-drawers/SideDrawer';
import { useSideDrawerOpen } from '../side-drawers/SideDrawerProvider';
import { ObjectTreePanel } from './ObjectTreePanel';

/** The object tree drawer; the panel mounts only while it is open. */
export function ObjectTreeDrawer() {
  const open = useSideDrawerOpen('objectTree');
  return (
    <SideDrawer open={open} className="object-tree-drawer" label="Object tree">
      {open && <ObjectTreePanel />}
    </SideDrawer>
  );
}
