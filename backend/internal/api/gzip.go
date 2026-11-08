package api

import (
	"compress/gzip"
	"io"
	"net/http"
	"strings"
	"sync"

	"github.com/gin-gonic/gin"
)

var gzipWriterPool = sync.Pool{
	New: func() any {
		writer, _ := gzip.NewWriterLevel(io.Discard, gzip.BestSpeed)
		return writer
	},
}

type gzipResponseWriter struct {
	gin.ResponseWriter
	writer *gzip.Writer
}

func (w *gzipResponseWriter) Write(data []byte) (int, error) {
	return w.writer.Write(data)
}

func (w *gzipResponseWriter) WriteString(value string) (int, error) {
	return w.writer.Write([]byte(value))
}

func (w *gzipResponseWriter) WriteHeader(code int) {
	w.Header().Del("Content-Length")
	w.ResponseWriter.WriteHeader(code)
}

// gzipMiddleware 只压缩 API 的 JSON 响应，跳过文件下载和验证码图片。
func gzipMiddleware() gin.HandlerFunc {
	return func(c *gin.Context) {
		path := c.Request.URL.Path
		if c.Request.Method == http.MethodOptions ||
			!strings.HasPrefix(path, "/api") ||
			strings.HasPrefix(path, "/api/auth/captcha") ||
			!strings.Contains(c.GetHeader("Accept-Encoding"), "gzip") {
			c.Next()
			return
		}

		writer := gzipWriterPool.Get().(*gzip.Writer)
		writer.Reset(c.Writer)
		defer func() {
			_ = writer.Close()
			writer.Reset(io.Discard)
			gzipWriterPool.Put(writer)
		}()

		c.Header("Content-Encoding", "gzip")
		c.Header("Vary", "Accept-Encoding")
		c.Writer = &gzipResponseWriter{ResponseWriter: c.Writer, writer: writer}
		c.Next()
	}
}
