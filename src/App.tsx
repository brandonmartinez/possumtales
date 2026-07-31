import { useEffect } from 'react';
import { Navigate, Route, Routes, useLocation, useParams } from 'react-router-dom';
import { Layout } from './components/Layout';
import { Archive } from './pages/Archive';
import { PostPage } from './pages/PostPage';
import { About } from './pages/About';
import { NotFound } from './pages/NotFound';

export default function App() {
  return (
    <Layout>
      <ScrollToTop />
      <Routes>
        <Route path="/" element={<Archive />} />
        <Route path="/:year/:month/:day/:slug/" element={<PostPage />} />

        {/*
          Pre-2009 permalinks used an /archives/ prefix. They were live for
          years and are still linked from inside the posts themselves, so they
          redirect rather than 404.
        */}
        <Route path="/archives/:year/:month/:day/:slug/" element={<ArchivesRedirect />} />
        <Route path="/archives/*" element={<Navigate to="/" replace />} />

        <Route path="/about/" element={<About />} />
        <Route path="/tag/:slug/" element={<Archive scope="tag" />} />
        <Route path="/category/:slug/" element={<Archive scope="category" />} />
        <Route path="/speaker/:slug/" element={<Archive scope="speaker" />} />

        <Route path="*" element={<NotFound />} />
      </Routes>
    </Layout>
  );
}

function ArchivesRedirect() {
  const { year, month, day, slug } = useParams();
  return <Navigate to={`/${year}/${month}/${day}/${slug}/`} replace />;
}

/** Reading a quote should start at the quote, not wherever the last scroll was. */
function ScrollToTop() {
  const { pathname } = useLocation();
  useEffect(() => {
    window.scrollTo(0, 0);
  }, [pathname]);
  return null;
}
