import { twitterArticles } from "./articles";
import BlogTabs from "./BlogTabs";
import { getAllBlogPosts } from "./utils";
import Layout from "@portfolio/components/layout/layout";

export const metadata = {
  title: "Blogs | Portfolio",
  description:
    "Read the latest articles, tutorials, and personal thoughts on technology, programming, and more.",
};

export const revalidate = 3600;

export default async function BlogsPage() {
  const allPosts = await getAllBlogPosts();

  const technicalPosts = [
    ...allPosts.filter((post) => post.type !== "personal"),
    ...twitterArticles,
  ].sort((a, b) => new Date(b.date).getTime() - new Date(a.date).getTime());

  const personalPosts = allPosts.filter((post) => post.type === "personal");

  return (
    <Layout
      showHeader
      title="Blogs"
      subtitle="Latest articles and tutorials"
    >
      <BlogTabs technical={technicalPosts} personal={personalPosts} />
    </Layout>
  );
}
