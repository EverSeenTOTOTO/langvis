import { useStore } from '@/client/store';
import { NodeMetaEntity } from '@/shared/entities/NodeMeta';
import { Avatar, Col, Divider, Input, Row, Tooltip } from 'antd';
import { groupBy } from 'lodash-es';
import { observer } from 'mobx-react-lite';
import { useDrag } from 'react-dnd';

const DraggableNode = (props: NodeMetaEntity) => {
  const [{ isDragging }, drag] = useDrag(() => ({
    type: props.name,
    item: props,
    collect: monitor => ({
      isDragging: monitor.isDragging(),
      handlerId: monitor.getHandlerId(),
    }),
  }));

  const opacity = isDragging ? 0.4 : 1;
  return (
    <Col
      ref={drag}
      style={{
        cursor: 'pointer',
        opacity,
      }}
    >
      <Tooltip title={props.description || props.name} placement="bottomLeft">
        <Avatar size="large">{props.name}</Avatar>
      </Tooltip>
    </Col>
  );
};

const NodeMenu = () => {
  const setting = useStore('setting');
  const home = useStore('home');

  const groupedByType = groupBy(home.availableNodemetas, each => each.type);

  return (
    <div className="node-menu">
      <Input.Search placeholder={setting.tr('Search nodes')} />
      {Object.keys(groupedByType).map(type => {
        return (
          <div key={type} className="node-category">
            <Divider orientationMargin="8">{setting.tr(type)}</Divider>
            <Row gutter={12}>
              {groupedByType[type].map(meta => {
                return <DraggableNode {...meta} key={meta.name} />;
              })}
            </Row>
          </div>
        );
      })}
    </div>
  );
};

export default observer(NodeMenu);
