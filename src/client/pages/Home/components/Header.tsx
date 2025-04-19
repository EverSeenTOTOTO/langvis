import { Col, Divider, Row, Typography } from 'antd';
import GraphSelect from './GraphSelect';
import Settings from './Settings';
import Control from './Control';

const Header = () => {
  return (
    <Row wrap={false} align="middle" className="header">
      <Col className="logo">
        <Typography.Title level={3}>Langvis</Typography.Title>
      </Col>
      <Divider type="vertical" />
      <Col span={4} className="graph-select">
        <GraphSelect />
      </Col>
      <Col flex={1} />
      <Divider type="vertical" />
      <Col>
        <Control />
      </Col>
      <Col flex={1} />
      <Divider type="vertical" />
      <Col>
        <Settings />
      </Col>
    </Row>
  );
};

export default Header;
