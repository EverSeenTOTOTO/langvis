import { Navigate } from 'react-router';

/** 首页即终端（对话页已终端化）：客户端重定向，SSR 只出壳。 */
const Home: React.FC = () => <Navigate to="/terminal" replace />;

export default Home;
