const express = require('express');
  const path = require('path');
  const app = express();
  const PORT = process.env.PORT || 3000;

  // Serve static files from the root directory
  app.use(express.static(__dirname));

  // Serve the wireframe document
  app.get('/wireframes', (req, res) => {
    res.sendFile(path.join(__dirname, 'project-plan-wireframes.html'));
  });

  app.get('/', (req, res) => {
    res.send(`
      <!DOCTYPE html>
      <html>
      <head>
        <title>Project Documents</title>
        <style>
          body {
            font-family: system-ui, sans-serif;
            max-width: 600px;
            margin: 100px auto;
            padding: 20px;
            text-align: center;
          }
          h1 { color: #2563eb; }
          a {
            display: inline-block;
            background: #2563eb;
            color: white;
            padding: 15px 30px;
            text-decoration: none;
            border-radius: 8px;
            font-size: 18px;
            margin: 20px;
            transition: all 0.3s;
          }
          a:hover {
            background: #1d4ed8;
            transform: translateY(-2px);
          }
        </style>
      </head>
      <body>
        <h1>📋 Project Documentation</h1>
        <p>Click below to view your Time & Attendance System wireframes:</p>
        <a href="/wireframes">🎨 View Wireframes & Project Plan</a>
        <p style="margin-top: 40px; color: #64748b;">
          <small>Once opened, use the print button to save as PDF</small>
        </p>
      </body>
      </html>
    `);
  });

  app.listen(PORT, () => {
    console.log(`🚀 Server running on port ${PORT}`);
    console.log(`📄 View wireframes at: http://localhost:${PORT}/wireframes`);
  });
  