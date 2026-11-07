//go:build windows

package main

import (
	"context"
	"embed"
	"flag"
	"fmt"
	"io/fs"
	"log"
	"os"
	"path/filepath"
	"strings"
	"syscall"
	"time"
	"unsafe"

	"github.com/wailsapp/wails/v2"
	"github.com/wailsapp/wails/v2/pkg/options"
	"github.com/wailsapp/wails/v2/pkg/options/assetserver"
	windowsoptions "github.com/wailsapp/wails/v2/pkg/options/windows"

	"navideck/backend/internal/api"
	"navideck/backend/internal/auth"
	"navideck/backend/internal/db"
	"navideck/backend/internal/model"
	"navideck/backend/internal/store"
)

//go:embed all:web/dist
var webAssets embed.FS

func main() {
	dataFlag := flag.String("data", "", "数据目录（默认 %APPDATA%\\StarBaseDesktop）")
	flag.Parse()

	dataDir, err := resolveDataDir(*dataFlag)
	if err != nil {
		showError("StarBase 启动失败", "无法确定数据目录："+err.Error())
		return
	}
	if err := os.MkdirAll(dataDir, 0o700); err != nil {
		showError("StarBase 启动失败", "无法创建数据目录：\n"+dataDir+"\n"+err.Error())
		return
	}
	logFile, err := os.OpenFile(filepath.Join(dataDir, "desktop.log"), os.O_CREATE|os.O_APPEND|os.O_WRONLY, 0o600)
	if err == nil {
		defer logFile.Close()
		log.SetOutput(logFile)
	}
	log.Printf("StarBase Desktop %s 启动，数据目录: %s", model.Version, dataDir)

	if err := run(dataDir); err != nil {
		log.Printf("运行失败: %v", err)
		showError("StarBase 运行失败", err.Error())
	}
}

func run(dataDir string) error {
	appStore, err := store.Open(dataDir)
	if err != nil {
		return fmt.Errorf("初始化数据目录失败：%w", err)
	}

	demoPath := filepath.Join(appStore.DataDir(), "demo.db")
	if err := db.SeedDemo(demoPath); err != nil {
		log.Printf("初始化示例数据库失败: %v", err)
	}
	if appStore.FirstRun() {
		if _, created, err := appStore.EnsureDemo(""); err != nil {
			log.Printf("创建示例连接失败: %v", err)
		} else if created {
			log.Printf("已创建示例数据库: %s", demoPath)
		}
	}

	// 桌面版是本机单用户应用：不启用账号体系，直接连接用户有权访问的数据库。
	authSvc, _, err := auth.NewService(auth.Options{Enabled: false, DataDir: appStore.DataDir()})
	if err != nil {
		return fmt.Errorf("初始化本地服务失败：%w", err)
	}

	manager := db.NewManager(appStore.DataDir())
	defer manager.Close()

	staticFS, err := fs.Sub(webAssets, "web/dist")
	if err != nil {
		return fmt.Errorf("加载前端资源失败：%w", err)
	}
	if _, err := fs.Stat(staticFS, "index.html"); err != nil {
		return fmt.Errorf("前端资源缺失，请先运行 build-desktop.bat 重新构建：%w", err)
	}

	server := &api.Server{
		Store:   appStore,
		DB:      manager,
		Auth:    authSvc,
		Static:  staticFS,
		Started: time.Now(),
		Desktop: true,
	}

	log.Printf("本地数据库引擎已就绪，监听由桌面窗口内置处理")
	return wails.Run(&options.App{
		Title:            "StarBase Desktop",
		Width:            1440,
		Height:           900,
		MinWidth:         1080,
		MinHeight:        680,
		BackgroundColour: options.NewRGB(18, 22, 28),
		AssetServer: &assetserver.Options{
			Assets:  staticFS,
			Handler: server.Router(),
		},
		SingleInstanceLock:       &options.SingleInstanceLock{UniqueId: "com.starbase.desktop"},
		EnableDefaultContextMenu: true,
		Windows: &windowsoptions.Options{
			WebviewUserDataPath: filepath.Join(dataDir, "webview"),
			Theme:               windowsoptions.SystemDefault,
		},
		OnStartup: func(ctx context.Context) {
			log.Printf("桌面窗口已启动")
		},
		OnShutdown: func(ctx context.Context) {
			log.Printf("桌面程序正在退出")
		},
	})
}

func resolveDataDir(flagValue string) (string, error) {
	dir := strings.TrimSpace(flagValue)
	if dir == "" {
		dir = strings.TrimSpace(os.Getenv("NAVIDECK_DATA_DIR"))
	}
	if dir != "" {
		return filepath.Abs(dir)
	}
	base, err := os.UserConfigDir()
	if err != nil {
		return "", err
	}
	current := filepath.Join(base, "StarBaseDesktop")
	legacy := filepath.Join(base, "NavideckDesktop")
	if _, statErr := os.Stat(current); os.IsNotExist(statErr) {
		if _, legacyErr := os.Stat(legacy); legacyErr == nil {
			return legacy, nil
		}
	}
	return current, nil
}

func showError(title, message string) {
	titlePtr, _ := syscall.UTF16PtrFromString(title)
	messagePtr, _ := syscall.UTF16PtrFromString(message)
	proc := syscall.NewLazyDLL("user32.dll").NewProc("MessageBoxW")
	proc.Call(0, uintptr(unsafe.Pointer(messagePtr)), uintptr(unsafe.Pointer(titlePtr)), 0x00000010)
}
