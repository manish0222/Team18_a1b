// ============================================================================
// RideSync - Global Ride-Hailing Network
// 03_workflow4_facet.js: Workflow 4 - Multi-Faceted Review Analytics ($facet)
// ============================================================================

const dbName = 'ridesync_db';
// [A1B fix] was `const db = db.getSiblingDB(dbName);` - redeclaring the mongosh
// global `db` with const reads it before initialisation (ReferenceError).
db = db.getSiblingDB(dbName);

print("Running multi-faceted review analytics pipeline on TripReviews...");

const pipeline = [
    {
        $facet: {
            // Facet 1: Rating Distribution (1-5 stars)
            "rating_distribution": [
                {
                    $group: {
                        _id: "$rating",
                        count: { $sum: 1 }
                    }
                },
                {
                    $project: {
                        _id: 0,
                        stars: "$_id",
                        count: 1
                    }
                },
                {
                    $sort: { stars: -1 }
                }
            ],

            // Facet 2: Most Frequent Feedback Tags
            "top_feedback_tags": [
                {
                    $unwind: "$feedback_tags"
                },
                {
                    $group: {
                        _id: "$feedback_tags",
                        tag_count: { $sum: 1 }
                    }
                },
                {
                    $project: {
                        _id: 0,
                        tag: "$_id",
                        tag_count: 1
                    }
                },
                {
                    $sort: { tag_count: -1 }
                },
                {
                    $limit: 10
                }
            ],

            // Facet 3: Overall Summary Metrics
            "overall_summary": [
                {
                    $group: {
                        _id: null,
                        total_reviews: { $sum: 1 },
                        average_rating: { $avg: "$rating" },
                        std_dev_rating: { $stdDevPop: "$rating" }
                    }
                },
                {
                    $project: {
                        _id: 0,
                        total_reviews: 1,
                        average_rating: { $round: ["$average_rating", 2] },
                        std_dev_rating: { $round: ["$std_dev_rating", 2] }
                    }
                }
            ]
        }
    }
];

const analyticsReport = db.TripReviews.aggregate(pipeline).toArray();
printjson(analyticsReport);
