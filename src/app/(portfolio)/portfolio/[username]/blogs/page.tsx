import BlogTabs from "@/app/(portfolio)/portfolio/blogs/BlogTabs";
import { getAllBlogPosts } from "@/app/(portfolio)/portfolio/blogs/utils";
import Layout from "@portfolio/components/layout/layout";

// Blogs are fetched from R2 — same for all users for now
// (each user would have their own R2 prefix in a future iteration)
export const revalidate = 3600;

export default async function UserBlogsPage() {
  const allPosts = await getAllBlogPosts();

  const technicalPosts = allPosts.filter((post) => post.type !== "personal")
    .sort((a, b) => new Date(b.date).getTime() - new Date(a.date).getTime());

  const personalPosts = allPosts.filter((post) => post.type === "personal");

  return (
    <Layout showHeader title="Blogs" subtitle="Latest articles and tutorials">
      <BlogTabs technical={technicalPosts} personal={personalPosts} />
    </Layout>
  );
}
