import { cache } from "react";

import { getAllBlogPostsFromS3 } from "@portfolio/lib/r2Client";

export const getAllBlogPosts = cache(async () => {
  try {
    const blogPosts = await getAllBlogPostsFromS3();

    return blogPosts.map((post) => ({
      slug: post.slug,
      title: post.title,
      date: post.date,
      excerpt: post.excerpt,
      type: post.type,
      url: post.url,
    }));
  } catch {
    return [];
  }
});
