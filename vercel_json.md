{
  "version": 2,
  "routes": [
    {
      "src": "^/$",
      "dest": "/js.html"
    },
    {
      "src": "^/gallery/([^/]+)/([^/]+)$",
      "dest": "/js.html?slug=$1&photoId=$2"
    },
    {
      "src": "^/gallery/([^/]+)$",
      "dest": "/js.html?slug=$1"
    },
    {
      "src": "^/monitor/([^/]+)$",
      "dest": "/js.html?view=slideshow&slug=$1"
    }
  ]
}