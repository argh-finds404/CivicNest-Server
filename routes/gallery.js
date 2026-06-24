const express = require('express');
const router = express.Router();
const Issue = require('../models/Issue');
const { getCollection } = require('../config/db');
const { ObjectId } = require('mongodb');
const { verifyToken } = require('../middleware/auth');
const { adminOnly } = require('../middleware/adminOnly');

// GET /gallery
// Returns all auto-generated (solved issues) and custom-uploaded success stories
router.get('/', async (req, res) => {
  try {
    const { area, limit = 20 } = req.query;

    // 1. Auto-generated solved issues
    const query = {
      approvalStatus: 'approved',
      status: 'solved',
      'images.0': { $exists: true },
      'resolutionProofs.0.images.0': { $exists: true },
    };
    if (area) query.area = area;

    const issues = await Issue.find(query)
      .select('title category location area images resolutionProofs resolvedAt upvotes')
      .sort({ resolvedAt: -1 })
      .limit(parseInt(limit))
      .lean();

    const issueItems = issues.map(issue => ({
      _id: issue._id.toString(),
      title: issue.title,
      category: issue.category,
      location: issue.location,
      area: issue.area,
      beforeImage: issue.images[0],
      afterImage: issue.resolutionProofs[0].images[0],
      resolvedAt: issue.resolvedAt || issue.updatedAt,
      upvotesCount: issue.upvotes?.length || 0,
      isCustom: false,
    }));

    // 2. Custom success stories uploaded directly by Admin
    const galleryStoriesCol = getCollection('gallery_stories');
    const customQuery = {};
    if (area) customQuery.area = area;

    const customStories = await galleryStoriesCol
      .find(customQuery)
      .sort({ resolvedAt: -1 })
      .limit(parseInt(limit))
      .toArray();

    const customItems = customStories.map(story => ({
      _id: story._id.toString(),
      title: story.title,
      category: story.category,
      location: story.location,
      area: story.area,
      beforeImage: story.beforeImage,
      afterImage: story.afterImage,
      resolvedAt: story.resolvedAt,
      upvotesCount: story.upvotes?.length || 0,
      isCustom: true,
    }));

    // 3. Merge & Sort by date in descending order
    const merged = [...issueItems, ...customItems].sort((a, b) => {
      return new Date(b.resolvedAt) - new Date(a.resolvedAt);
    });

    // Apply limit on the merged list
    const finalItems = merged.slice(0, parseInt(limit));

    res.json({ issues: finalItems });
  } catch (error) {
    console.error('Error fetching gallery:', error);
    res.status(500).json({ error: error.message });
  }
});

// POST /gallery (Admin Direct Upload)
router.post('/', verifyToken, adminOnly, async (req, res) => {
  try {
    const { title, category, area, location, beforeImage, afterImage } = req.body;
    if (!title || !category || !area || !location || !beforeImage || !afterImage) {
      return res.status(400).json({ error: 'All fields are required' });
    }

    const galleryStoriesCol = getCollection('gallery_stories');
    const newStory = {
      title: title.trim(),
      category: category.trim(),
      area: area.trim(),
      location: location.trim(),
      beforeImage: beforeImage.trim(),
      afterImage: afterImage.trim(),
      resolvedAt: new Date(),
      upvotes: [],
      uploadedBy: req.user.email,
    };

    const result = await galleryStoriesCol.insertOne(newStory);
    res.status(201).json({ success: true, _id: result.insertedId, story: newStory });
  } catch (error) {
    console.error('Error uploading custom gallery story:', error);
    res.status(500).json({ error: error.message });
  }
});

// DELETE /gallery/:id (Admin Direct Delete)
router.delete('/:id', verifyToken, adminOnly, async (req, res) => {
  try {
    const galleryStoriesCol = getCollection('gallery_stories');
    const result = await galleryStoriesCol.deleteOne({ _id: new ObjectId(req.params.id) });
    if (result.deletedCount === 0) {
      return res.status(404).json({ error: 'Custom story not found' });
    }
    res.json({ success: true, message: 'Custom success story deleted successfully' });
  } catch (error) {
    console.error('Error deleting custom gallery story:', error);
    res.status(500).json({ error: error.message });
  }
});

module.exports = router;
