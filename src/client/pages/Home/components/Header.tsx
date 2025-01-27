import { Col, Row } from 'antd';
import GraphSelect from './GraphSelect';
import ThemeToggle from './ThemeToggle';

const Header = () => {
  return (
    <Row wrap={false} align="middle" className="header">
      <Col span={4}>
        <GraphSelect style={{ width: '100%' }} />
      </Col>
      <Col style={{ marginInlineStart: 'auto' }}>
        <ThemeToggle />
      </Col>
    </Row>
  );
};

export default Header;
