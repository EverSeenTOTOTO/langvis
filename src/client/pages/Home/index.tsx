import { observer } from 'mobx-react-lite';
import Header from './components/Header';
import './index.scss';

const Home = () => {
  return <Header />;
};

export default observer(Home);

