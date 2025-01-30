import { useStore } from '@/client/store';
import { Input, Tree } from 'antd';
import { observer } from 'mobx-react-lite';

const NodeMenu = () => {
  const setting = useStore('setting');

  return (
    <div className="node-menu">
      <Input.Search placeholder={setting.tr('Search nodes')} />
      <Tree defaultExpandAll treeData={[]} />
    </div>
  );
};

export default observer(NodeMenu);
