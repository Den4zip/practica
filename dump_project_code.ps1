# Define the project root directory
$ProjectRoot = Get-Location

# Define the output file path
$OutputFile = Join-Path $ProjectRoot "project_code_dump.txt"

# Define patterns for directories and files to exclude
$ExcludeDirs = @(
    ".git",
    "bin",
    "obj",
    ".vs",
    "packages",
    "node_modules",
    "TestResults",
    "out",
    "build",
    "target",
    "dist"
)
$ExcludeFiles = @(
    "*.sln",
    "*.user",
    "*.bak",
    "*.pdb",
    "*.dll",
    "*.exe",
    "*.zip",
    "*.tar",
    "*.gz",
    "*.log",
    "*.tmp",
    "*.csproj.user",
    "*.suo",
    "*.cache",
    "*.db"
)

# Clear the output file if it exists
Remove-Item $OutputFile -ErrorAction SilentlyContinue

Write-Host "Starting to collect project code into '$OutputFile'..."

# Get all files, excluding specified directories and file types
Get-ChildItem -Path $ProjectRoot -Recurse -File | ForEach-Object {
    $file = $_
    $filePathRelativeToRoot = $file.FullName.Substring($ProjectRoot.FullName.Length + 1)
    
    # Check if the file or its parent directory should be excluded
    $shouldExclude = $false
    foreach ($dir in $ExcludeDirs) {
        if ($file.DirectoryName -like "*\$dir*" -or $filePathRelativeToRoot.StartsWith("$dir") ) {
            $shouldExclude = $true
            break
        }
    }
    if ($shouldExclude) {
        Write-Host "Excluding directory: $($file.DirectoryName)" -ForegroundColor Yellow
        continue
    }

    foreach ($pattern in $ExcludeFiles) {
        if ($file.Name -like $pattern) {
            $shouldExclude = $true
            break
        }
    }
    if ($shouldExclude) {
        Write-Host "Excluding file: $($file.Name)" -ForegroundColor Yellow
        continue
    }
    
    # Write file header and content
    Add-Content -Path $OutputFile -Value "`n--- File: $filePathRelativeToRoot ---`n"
    Add-Content -Path $OutputFile -Value (Get-Content $file.FullName -Raw -Encoding UTF8)
    Write-Host "Added: $filePathRelativeToRoot" -ForegroundColor Green
}

Write-Host "`nFinished collecting project code. Output saved to '$OutputFile'."