package api

import (
	"fmt"
	"net/http"
	"os"
	"path/filepath"

	"github.com/gin-gonic/gin"
)

var allowedDownloadFiles = map[string]bool{
	"StarBaseDesktop.exe":                true,
	"StarBase-Desktop-Windows-amd64.zip": true,
	"StarBase-Agent-Windows-amd64.zip":   true,
	"StarBase-Agent-Unix-amd64.tar.gz":   true,
	"StarBase-Server-Linux-amd64.tar.gz": true,
	"SHA256SUMS.txt":                     true,
}

// downloadFile 提供站内本地下载，文件放在数据目录的 downloads/ 下。
// 只允许白名单文件，避免路径穿越；非 /api 路径，因此无需登录也可下载。
func (s *Server) downloadFile(c *gin.Context) {
	name := c.Param("file")
	if !allowedDownloadFiles[name] {
		abortErr(c, http.StatusNotFound, fmt.Errorf("下载文件不存在"))
		return
	}

	dir := s.DownloadsDir
	if dir == "" && s.Store != nil {
		dir = filepath.Join(s.Store.DataDir(), "downloads")
	}
	if dir == "" {
		dir = "downloads"
	}

	path := filepath.Join(dir, name)
	info, err := os.Stat(path)
	if err != nil || info.IsDir() {
		abortErr(c, http.StatusNotFound, fmt.Errorf("下载文件尚未部署，请使用 GitHub Releases 下载"))
		return
	}

	c.Header("Cache-Control", "public, max-age=300")
	c.FileAttachment(path, name)
}
